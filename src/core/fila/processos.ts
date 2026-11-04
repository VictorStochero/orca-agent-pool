import { availableParallelism } from 'node:os'

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
    const nome = nomes.find((n) => a === n || a.startsWith(`${n}=`))
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

const base = (t: string) => (t.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat)$/, '')

/**
 * Comando explícito: `fila.processos` é teto nas flags de paralelismo que o agente passou. Pedido menor fica.
 * Laravel/Pest/ParaTest (`--parallel`, ganha `--processes=<teto>` se faltar), pytest-xdist e vitest/jest.
 */
// shortcut: `go test -p`, `cargo test -- --test-threads` e `dotnet test -m:` não são limitados; acrescentar a forma de cada um se o agente passar a usá-las.
export function limitarProcessos(argv: string[], teto: number, nucleos = availableParallelism()): { comando: string[]; ajustes: Ajuste[] } {
  if (!Number.isInteger(teto) || teto < 1) return { comando: argv, ajustes: [] }
  let comando = argv
  const ajustes: Ajuste[] = []
  const passo = <R extends { comando: string[]; ajustes: Ajuste[] }>(r: R): R => {
    comando = r.comando
    ajustes.push(...r.ajustes)
    return r
  }
  const automatico: Resolver = (v) => (/^(auto|logical)$/.test(v) ? nucleos : null)
  const paralelo = comando.some((a) => LARAVEL.test(base(a))) ? comando.indexOf('--parallel') : -1
  if (paralelo >= 0) {
    if (!passo(limitarFlag(comando, teto, ['--processes'], false, automatico)).achou) {
      comando = [...comando.slice(0, paralelo + 1), `--processes=${teto}`, ...comando.slice(paralelo + 1)]
      ajustes.push({ de: null, para: `--processes=${teto}` })
    }
  }
  if (comando.some((a) => PYTEST.test(base(a)))) passo(limitarFlag(comando, teto, ['--numprocesses'], true, automatico))
  passo(limitarFlag(comando, teto, ['--maxWorkers'], false, (v) => {
    const pct = /^(\d+)%$/.exec(v)
    return pct ? Math.max(1, Math.floor((nucleos * Number(pct[1])) / 100)) : null
  }))
  return { comando, ajustes }
}

/** `--processes=N` ou `--processes N` do comando, ou null. */
export function processosDoComando(comando: string[]): number | null {
  for (let i = 0; i < comando.length; i++) {
    const v = comando[i].startsWith('--processes=') ? comando[i].slice(12) : comando[i] === '--processes' ? comando[i + 1] : undefined
    if (v !== undefined && NUM.test(v)) return Number(v)
  }
  return null
}
