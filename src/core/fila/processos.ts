import { availableParallelism } from 'node:os'
import { nomeDoExecutavel } from '../executavel.ts'

/** Mudança feita numa flag de paralelismo; `de` null = flag acrescentada. */
export type Ajuste = { de: string | null; para: string }

const NUM = /^\d+$/
const PYTEST = /^(pytest|py\.test)$/
const LARAVEL = /^(artisan|pest|paratest|sail)$/

/** Quantos processos o valor simbólico (`auto`, `25%`) representa, ou null se não é simbólico. */
type Resolver = (v: string) => number | null

/** Valor novo se o pedido passa do teto ou é simbólico (vira `min(resolvido, teto)`); null se fica como veio. */
function novoValor(v: string, teto: number, resolver: Resolver): string | null {
  if (NUM.test(v)) return Number(v) > teto ? String(teto) : null
  const n = resolver(v)
  return n === null ? null : String(Math.min(n, teto))
}

/** Reescreve as flags `longas` (e `-n`, se `curta`) nas formas `--f N`, `--f=N`, `-nN`. */
function limitarFlag(argv: string[], teto: number, longas: string[], curta: boolean, resolver: Resolver) {
  const comando = [...argv]
  const ajustes: Ajuste[] = []
  let achou = false
  const nomes = curta ? [...longas, '-n'] : longas
  for (let i = 0; i < comando.length; i++) {
    const a = comando[i]
    const nome = nomes.find(n => a === n || a.startsWith(`${n}=`))
    if (nome && a === nome && comando[i + 1] !== undefined) {
      achou = true
      const v = comando[i + 1]
      const nv = novoValor(v, teto, resolver)
      if (nv) {
        ajustes.push({ de: `${a} ${v}`, para: `${a} ${nv}` })
        comando[i + 1] = nv
      }
      i++
    } else if (nome) {
      achou = true
      const v = a.slice(nome.length + 1)
      const nv = novoValor(v, teto, resolver)
      if (nv) {
        ajustes.push({ de: a, para: `${nome}=${nv}` })
        comando[i] = `${nome}=${nv}`
      }
    } else if (curta && /^-n[^-=]/.test(a)) {
      achou = true
      const nv = novoValor(a.slice(2), teto, resolver)
      if (nv) {
        ajustes.push({ de: a, para: `-n${nv}` })
        comando[i] = `-n${nv}`
      }
    }
  }
  return { comando, ajustes, achou }
}

/**
 * Comando explícito: `fila.processos` é teto nas flags de paralelismo que o agente passou. Pedido menor fica.
 * `artisan test` e Pest (`--parallel` ou `-p`, ganha `--processes=<teto>` se faltar; o ParaTest fica como veio), pytest-xdist e vitest/jest.
 */
// shortcut: `go test -p`, `cargo test -- --test-threads` e `dotnet test -m:` não são limitados;
// upgrade: acrescentar a forma de cada um se o agente passar a usá-las.
export function limitarProcessos(argv: string[], teto: number, nucleos = availableParallelism()): { comando: string[]; ajustes: Ajuste[] } {
  if (!Number.isInteger(teto) || teto < 1) return { comando: argv, ajustes: [] }
  let comando = argv
  const ajustes: Ajuste[] = []
  const passo = <R extends { comando: string[]; ajustes: Ajuste[] }>(r: R): R => {
    comando = r.comando
    ajustes.push(...r.ajustes)
    return r
  }
  const automatico: Resolver = v => (/^(auto|logical)$/.test(v) ? nucleos : null)
  const paralelo = indiceParalelo(comando)
  if (paralelo >= 0) {
    if (!passo(limitarFlag(comando, teto, ['--processes'], false, automatico)).achou) {
      comando = [...comando.slice(0, paralelo + 1), `--processes=${teto}`, ...comando.slice(paralelo + 1)]
      ajustes.push({ de: null, para: `--processes=${teto}` })
    }
  }
  if (comando.some(a => PYTEST.test(nomeDoExecutavel(a)))) passo(limitarFlag(comando, teto, ['--numprocesses'], true, automatico))
  passo(
    limitarFlag(comando, teto, ['--maxWorkers'], false, v => {
      const pct = /^(\d+)%$/.exec(v)
      return pct ? Math.max(1, Math.floor((nucleos * Number(pct[1])) / 100)) : null
    }),
  )
  return { comando, ajustes }
}

/** `artisan test` (php, sail ou ddev): só ele tem `--drop-databases`. */
const ehArtisanTest = (comando: string[]): boolean => comando.some((a, i) => nomeDoExecutavel(a) === 'artisan' && comando[i + 1] === 'test')

/**
 * Posição de `--parallel` num comando Laravel/Pest/ParaTest, ou do atalho `-p` (vale no `artisan test` e no Pest; no ParaTest é `--processes`); -1 se não é paralelo.
 * Só conta depois do programa: o `-p` de um invólucro (`docker compose -p x`, `docker run -p 80:80`) não é do teste.
 */
function indiceParalelo(comando: string[]): number {
  const programa = comando.findIndex(a => LARAVEL.test(nomeDoExecutavel(a)))
  if (programa < 0) return -1
  const atalho = ehArtisanTest(comando) || comando.some(a => nomeDoExecutavel(a) === 'pest')
  const i = comando.slice(programa).findIndex(a => a === '--parallel' || (atalho && a === '-p'))
  return i < 0 ? -1 : programa + i
}

/** `artisan test` paralelo apaga os bancos `<base>_test_N` ao fim com `--drop-databases` (exige Laravel 9+). */
export function comLimpezaDeBancos(comando: string[]): string[] {
  if (!ehArtisanTest(comando)) return comando
  const paralelo = indiceParalelo(comando)
  if (paralelo < 0 || comando.includes('--drop-databases')) return comando
  return [...comando.slice(0, paralelo + 1), '--drop-databases', ...comando.slice(paralelo + 1)]
}
