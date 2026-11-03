import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Config, Conta, Medida, OrcaCli } from '../tipos.ts'
import type { Paths } from '../paths.ts'
import { acharAgente, executavelDe, programaDe } from '../catalogo.ts'
import { instalado } from '../deteccao.ts'
import { medirClaude, pastaDaConta, type DependenciasMedida } from './claude.ts'
import { medirOrca, type CotaOrca } from './orca.ts'

function chave(conta: Conta): string {
  return createHash('sha256').update(JSON.stringify([conta.nome, conta.agente, conta.config, conta.origem])).digest('hex')
}

function formaValida(medida: Medida | undefined): medida is Medida {
  try {
    if (!medida || !Number.isFinite(medida.medidaTs)) return false
    if (!['ok', 'erro', 'sem_login', 'sem_medida'].includes(medida.estado)) return false // `nao_configurada` nunca é gravada
    const percentual = (n: unknown) => n === null || typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
    if (![medida.curta, medida.longa].every(percentual)) return false
    if (medida.limites !== undefined && !(Array.isArray(medida.limites) && medida.limites.every(l => typeof l?.nome === 'string' && l.nome !== '' && percentual(l.curta) && percentual(l.longa)))) return false
    return medida.resetLongaTs === null || Number.isFinite(medida.resetLongaTs)
  } catch { return false }
}

function ler(medida: Medida | undefined, conta: Conta, agora: number, cacheMin: number): Medida | null {
  if (!formaValida(medida) || medida.conta !== conta.nome || medida.medidaTs > agora || agora - medida.medidaTs >= cacheMin * 60_000) return null
  return medida
}

function lerArquivo(p: Paths): Record<string, Medida> {
  try {
    const json = JSON.parse(readFileSync(join(p.medidas, 'contas.json'), 'utf8'))
    if (json && typeof json === 'object' && !Array.isArray(json)) return json
  } catch { /* Cache ausente ou ilegível exige coleta nova. */ }
  return {}
}

/** Medidas gravadas por `medirTodas`, sem medir e sem limite de idade: o worker religado mostra a cota (já marcada como antiga) até a primeira coleta. */
export function medidasGravadas(p: Paths): Medida[] {
  return Object.values(lerArquivo(p)).filter(formaValida)
}

/** Conta Claude com pasta própria que não existe: conferido antes de medir (rodar o `claude` ali criaria a pasta). */
function pastaAusente(conta: Conta, d: DependenciasMedida): string | null {
  if (conta.agente !== 'claude' || conta.origem !== 'manual' || !conta.config) return null
  const pasta = resolve(pastaDaConta(conta, d.home))
  return existsSync(pasta) ? null : `pasta_ausente:${pasta}`
}

/** CLI da conta fora do PATH; só rebaixa medida que falhou, pois o PATH do processo pode não ter tudo o que o terminal tem. */
function cliAusente(conta: Conta, d: DependenciasMedida): string | null {
  if (d.path === undefined) return null
  const programa = conta.comando ? programaDe(conta.comando) : null
  // Com caminho, confere o próprio arquivo (a pasta dele faz as vezes de PATH).
  if (programa && /[\\/]/.test(programa)) {
    if (/[$%]/.test(programa)) return null // variável que só o shell expande: não dá para conferir aqui
    const arquivo = /^~[\\/]/.test(programa) ? join(d.home, programa.slice(2)) : programa
    return instalado(basename(arquivo), dirname(arquivo)) ? null : `cli_ausente:${programa}`
  }
  const exe = programa ? executavelDe(programa) : null
  const candidatos = exe ? [exe] : acharAgente(conta.agente)?.comandos ?? []
  return candidatos.length && !candidatos.some((x) => instalado(x, d.path!)) ? `cli_ausente:${candidatos[0]}` : null
}

const naoConfigurada = (conta: Conta, d: DependenciasMedida, motivo: string): Medida =>
  ({ conta: conta.nome, medidaTs: d.agora, curta: null, longa: null, resetLongaTs: null, estado: 'nao_configurada', erro: motivo })

export async function medirTodas(c: Config, p: Paths, orca: OrcaCli, d: DependenciasMedida, cacheMin = 5): Promise<Medida[]> {
  let nativas: Map<string, CotaOrca> | undefined
  let falhouOrca = false
  const medidas: Medida[] = []
  const destino = join(p.medidas, 'contas.json')
  const anteriores = lerArquivo(p)
  const atualizadas: Record<string, Medida> = {}
  let mudou = false
  const medir = async (conta: Conta): Promise<Medida> => {
    if (conta.agente === 'claude' && conta.origem === 'manual') return medirClaude(conta, d)
    if (!nativas && !falhouOrca) {
      try { nativas = await medirOrca(orca) } catch { falhouOrca = true }
    }
    return {
      conta: conta.nome, medidaTs: d.agora, curta: null, longa: null, resetLongaTs: null,
      estado: falhouOrca ? 'erro' : 'sem_medida',
      ...(nativas?.get(conta.agente)),
    }
  }
  for (const conta of c.pool.contas) {
    const pasta = pastaAusente(conta, d)
    if (pasta) {
      medidas.push(naoConfigurada(conta, d, pasta))
      continue
    }
    const id = chave(conta)
    const cache = ler(anteriores[id], conta, d.agora, cacheMin)
    const medida = cache ?? await medir(conta)
    const cli = medida.estado === 'ok' ? null : cliAusente(conta, d)
    if (cli) {
      medidas.push(naoConfigurada(conta, d, cli)) // não vai ao cache: volta a medir quando o CLI aparecer
      continue
    }
    atualizadas[id] = medida
    medidas.push(medida)
    if (!cache) mudou = true
  }
  if (mudou) {
    mkdirSync(p.medidas, { recursive: true })
    const temporario = `${destino}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporario, JSON.stringify(atualizadas), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSync(temporario, destino)
    } finally { rmSync(temporario, { force: true }) }
  }
  return medidas
}
