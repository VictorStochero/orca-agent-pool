import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { vivoPadrao } from './fila/travas.ts'

type Sessao = { nome: string; pid: number; inicio: number | null }
/** Hora de criação (ms Unix) de cada pid vivo; null = a consulta falhou. */
export type Criacoes = (pids: number[]) => Map<number, number> | null

const FILETIME_UNIX_MS = 11_644_473_600_000
const TOLERANCIA_MS = 1_000
const CACHE_OK_MS = 15_000
const cacheProc = new Map<string, { ate: number; bate: boolean }>()

/** `procStart` do Claude Code é o FILETIME (100 ns desde 1601, acima de 2^53) da criação do processo. */
export function procStartMs(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null
  return Number(BigInt(v) / 10_000n) - FILETIME_UNIX_MS
}

/** Windows: hora de criação dos pids numa só consulta; fora dele null (não confere). */
export function criacaoDosPids(pids: number[]): Map<number, number> | null {
  if (process.platform !== 'win32') return null
  // O pid vem de arquivo e entra num comando.
  if (!pids.length || !pids.every((p) => Number.isInteger(p) && p > 0)) return null
  const filtro = pids.map((p) => `ProcessId=${p}`).join(' OR ')
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter "${filtro}" | ForEach-Object { "$($_.ProcessId) $([DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds())" }`],
    { windowsHide: true, timeout: 10_000, encoding: 'utf8' }
  )
  if (r.status !== 0) return null
  const m = new Map<number, number>()
  for (const l of String(r.stdout).split(/\r?\n/)) {
    const x = /^(\d+) (\d+)$/.exec(l.trim())
    if (x) m.set(Number(x[1]), Number(x[2]))
  }
  return m
}

/** Sessões interativas vivas de `<dir>/sessions/<pid>.json`; `soAgente` filtra as abertas com `--agent <papel>`. */
function lerSessoes(dir: string, vivo: (pid: number) => boolean, soAgente: boolean): Sessao[] {
  let nomes: string[]
  try { nomes = readdirSync(join(dir, 'sessions')).filter((n) => n.endsWith('.json')) } catch { return [] }
  const abertas: Sessao[] = []
  for (const n of nomes) {
    try {
      const s = JSON.parse(readFileSync(join(dir, 'sessions', n), 'utf8'))
      if (!Number.isInteger(s?.pid) || s.pid <= 0 || s.kind !== 'interactive' || !vivo(s.pid)) continue
      if (soAgente && !(typeof s.agent === 'string' && s.agent)) continue
      abertas.push({ nome: typeof s.name === 'string' && s.name ? s.name : String(s.pid), pid: s.pid, inicio: procStartMs(s.procStart) })
    } catch { /* Arquivo ilegível: ignora. */ }
  }
  return abertas
}

/** Nomes das sessões interativas abertas da conta Claude (só exibição). */
// shortcut: pid reaproveitado de arquivo que sobrou de travamento conta como sessão; só exibição, então não confere `procStart`.
export function sessoesAbertas(dir: string, vivo: (pid: number) => boolean = vivoPadrao): string[] {
  return lerSessoes(dir, vivo, false).map((s) => s.nome)
}

/**
 * Nomes das sessões abertas com `--agent <papel>` (worker): ocupam vaga enquanto vivas. No Windows a sessão só conta
 * se o processo do pid foi criado na hora do `procStart` (±1 s), numa consulta em lote; consulta que falha conta a sessão.
 */
// shortcut: fora do Windows só o pid vivo decide (pid reaproveitado de sessão órfã ocupa vaga); conferir a criação do processo via `ps -o lstart` ou /proc/<pid>/stat se aparecer.
export function agentesVivos(dir: string, vivo: (pid: number) => boolean = vivoPadrao, criacoes: Criacoes = criacaoDosPids): string[] {
  const sessoes = lerSessoes(dir, vivo, true)
  const agora = Date.now()
  for (const [k, v] of cacheProc) if (v.ate <= agora) cacheProc.delete(k)
  const chave = (s: Sessao) => `${s.pid}:${s.inicio}`
  const faltam = sessoes.filter((s) => s.inicio !== null && !cacheProc.has(chave(s)))
  const m = faltam.length ? criacoes([...new Set(faltam.map((s) => s.pid))]) : null
  if (faltam.length) {
    // A hora vem de depois da consulta: ela leva até 10 s e o prazo não pode nascer vencido.
    const depois = Date.now()
    for (const s of faltam) {
      // Consulta que falhou conta a sessão por 15 s, para não repetir a consulta lenta a cada leitura.
      const criado = m?.get(s.pid)
      const bate = !m || (criado !== undefined && Math.abs(criado - s.inicio!) <= TOLERANCIA_MS)
      // Não bater é definitivo (pid reaproveitado não volta a ser o processo original); bater vale 15 s.
      cacheProc.set(chave(s), { ate: bate ? depois + CACHE_OK_MS : Infinity, bate })
    }
  }
  return sessoes.filter((s) => s.inicio === null || (cacheProc.get(chave(s))?.bate ?? true)).map((s) => s.nome)
}
