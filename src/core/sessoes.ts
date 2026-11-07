import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { vivoPadrao } from './trava.ts'
import { CachePrazo, consultarProcessos } from './win32.ts'

type Sessao = { nome: string; pid: number; inicio: number | null }
/** Hora de criação (ms Unix) de cada pid vivo; null = a consulta falhou. */
export type Criacoes = (pids: number[]) => Promise<Map<number, number> | null>

const FILETIME_UNIX_MS = 11_644_473_600_000
const TOLERANCIA_MS = 1_000
const CACHE_OK_MS = 15_000
/** Por `pid:procStart`: o processo do pid foi criado na hora do `procStart`? */
const cacheProc = new CachePrazo<boolean>()
const SAIDA_CRIACAO = '"$($_.ProcessId) $([DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds())"'

/** `procStart` do Claude Code é o FILETIME (100 ns desde 1601, acima de 2^53) da criação do processo. */
export function procStartMs(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null
  return Number(BigInt(v) / 10_000n) - FILETIME_UNIX_MS
}

/** Filtro WQL dos pids; null fora do Windows (não confere) ou com pid inválido (o pid vem de arquivo e entra num comando). */
function filtroDosPids(pids: number[]): string | null {
  if (process.platform !== 'win32' || !pids.length || !pids.every(p => Number.isInteger(p) && p > 0)) return null
  return pids.map(p => `ProcessId=${p}`).join(' OR ')
}

function mapaDeCriacoes(linhas: string[] | null): Map<number, number> | null {
  if (!linhas) return null
  const m = new Map<number, number>()
  for (const l of linhas) {
    const x = /^(\d+) (\d+)$/.exec(l)
    if (x) m.set(Number(x[1]), Number(x[2]))
  }
  return m
}

/** Windows: hora de criação dos pids numa só consulta; fora dele null (não confere). */
export async function criacaoDosPids(pids: number[]): Promise<Map<number, number> | null> {
  const filtro = filtroDosPids(pids)
  return filtro ? mapaDeCriacoes(await consultarProcessos(filtro, SAIDA_CRIACAO)) : null
}

/** Sessões interativas vivas de `<dir>/sessions/<pid>.json`; `soAgente` filtra as abertas com `--agent <papel>`. */
function lerSessoes(dir: string, vivo: (pid: number) => boolean, soAgente: boolean): Sessao[] {
  let nomes: string[]
  try {
    nomes = readdirSync(join(dir, 'sessions')).filter(n => n.endsWith('.json'))
  } catch {
    return []
  }
  const abertas: Sessao[] = []
  for (const n of nomes) {
    try {
      const s = JSON.parse(readFileSync(join(dir, 'sessions', n), 'utf8'))
      if (!Number.isInteger(s?.pid) || s.pid <= 0 || s.kind !== 'interactive' || !vivo(s.pid)) continue
      if (soAgente && !(typeof s.agent === 'string' && s.agent)) continue
      abertas.push({ nome: typeof s.name === 'string' && s.name ? s.name : String(s.pid), pid: s.pid, inicio: procStartMs(s.procStart) })
    } catch {
      /* Arquivo ilegível: ignora. */
    }
  }
  return abertas
}

/** Nomes das sessões interativas abertas da conta Claude (só exibição). */
// shortcut: pid reaproveitado de arquivo que sobrou de travamento conta como sessão; só exibição, então não confere `procStart`.
export function sessoesAbertas(dir: string, vivo: (pid: number) => boolean = vivoPadrao): string[] {
  return lerSessoes(dir, vivo, false).map(s => s.nome)
}

const chaveProc = (s: Sessao) => `${s.pid}:${s.inicio}`
const pidsDe = (sessoes: Sessao[]) => [...new Set(sessoes.map(s => s.pid))]

/** Sessões com `procStart` cujo veredito não está em cache. */
const semVeredito = (sessoes: Sessao[], agora: number) =>
  sessoes.filter(s => s.inicio !== null && cacheProc.obter(chaveProc(s), agora) === undefined)

function registrar(sessoes: Sessao[], criacoes: Map<number, number> | null): void {
  // A hora vem de depois da consulta: ela leva até 10 s e o prazo não pode nascer vencido.
  const depois = Date.now()
  for (const s of sessoes) {
    // Consulta que falhou conta a sessão por 15 s, para não repetir a consulta lenta a cada leitura.
    const criado = criacoes?.get(s.pid)
    const bate = !criacoes || (criado !== undefined && Math.abs(criado - s.inicio!) <= TOLERANCIA_MS)
    // Não bater é definitivo (pid reaproveitado não volta a ser o processo original); bater vale 15 s.
    cacheProc.guardar(chaveProc(s), bate, bate ? depois + CACHE_OK_MS : Infinity)
  }
}

const nomesConferidos = (sessoes: Sessao[], agora: number) =>
  sessoes.filter(s => s.inicio === null || (cacheProc.obter(chaveProc(s), agora) ?? true)).map(s => s.nome)

/**
 * Nomes das sessões abertas com `--agent <papel>` (worker): ocupam vaga enquanto vivas. No Windows a sessão só conta
 * se o processo do pid foi criado na hora do `procStart` (±1 s), numa consulta em lote; consulta que falha conta a sessão.
 */
// shortcut: fora do Windows só o pid vivo decide (pid reaproveitado de sessão órfã ocupa vaga);
// upgrade: conferir a criação do processo via `ps -o lstart` ou /proc/<pid>/stat se aparecer.
export async function agentesVivos(
  dir: string,
  vivo: (pid: number) => boolean = vivoPadrao,
  criacoes: Criacoes = criacaoDosPids,
): Promise<string[]> {
  const sessoes = lerSessoes(dir, vivo, true)
  const agora = Date.now()
  const faltam = semVeredito(sessoes, agora)
  if (faltam.length) registrar(faltam, await criacoes(pidsDe(faltam)))
  return nomesConferidos(sessoes, agora)
}
