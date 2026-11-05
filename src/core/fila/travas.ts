import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Paths } from '../paths.ts'

export type InfoTrava = {
  pid: number
  /** ms desde a época: início da execução (trava) ou da espera (registro de espera). */
  inicio: number
  recurso: string | null
  worktree: string | null
  projeto: string | null
  comando: string | null
  fila: string
  /** Processo lançado pelo dono e hora (ms) logo após o spawn; sobrevive ao dono morto (ver `orfaoVivo`). */
  filho?: { pid: number; inicio: number }
}

export type TesteNaFila = {
  pid: number | null
  estado: 'execucao' | 'aguardando' | 'parado'
  recurso: string | null
  worktree: string | null
  projeto: string | null
  comando: string | null
  /** Chave da fila em que a trava ou a espera está (`global`, `proj-<x>`, `_teto`, banco…); null se o registro não a traz. */
  fila: string | null
  vaga: number | null
  desde_ts: number | null
}

/** Pasta do teto global dentro de state/fila; fica de fora da listagem (o mesmo teste já aparece na fila dele). */
export const TETO = '_teto'

export function vivoPadrao(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const JANELA_ANTES_MS = 5_000
const JANELA_DEPOIS_MS = 60_000
const CACHE_ORFAO_MS = 15_000
const cacheOrfao = new Map<string, { ate: number; vivo: boolean }>()

/** No Windows, o filho (ou um processo lançado por ele até 60 s depois) ainda vive? A janela de hora descarta pid reaproveitado. */
export function orfaoVivo(f: { pid: number; inicio: number }): boolean {
  if (process.platform !== 'win32') return false
  // O arquivo da trava não é confiável e o pid vai para dentro de um comando.
  if (!Number.isInteger(f.pid) || f.pid <= 0 || !Number.isFinite(f.inicio)) return false
  const agora = Date.now()
  for (const [k, v] of cacheOrfao) if (v.ate <= agora) cacheOrfao.delete(k)
  const chave = `${f.pid}:${f.inicio}`
  const visto = cacheOrfao.get(chave)
  if (visto) return visto.vivo
  const filtro = `(ProcessId=${f.pid} OR ParentProcessId=${f.pid}) AND Name<>'conhost.exe'`
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter "${filtro}" | ForEach-Object { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() }`],
    { windowsHide: true, timeout: 10_000, encoding: 'utf8' }
  )
  const vivo =
    r.status === 0 &&
    String(r.stdout)
      .split(/\r?\n/)
      .some((l) => l.trim() !== '' && Number(l) >= f.inicio - JANELA_ANTES_MS && Number(l) <= f.inicio + JANELA_DEPOIS_MS)
  // Morto com a janela já fechada não volta (processo novo cai fora dela): guarda sem prazo; falha da consulta não é final.
  const final = r.status === 0 && !vivo && agora > f.inicio + JANELA_DEPOIS_MS
  cacheOrfao.set(chave, { ate: final ? Infinity : agora + CACHE_ORFAO_MS, vivo })
  return vivo
}

/** Dono vivo, ou dono morto cujo filho lançado segue rodando. */
const travaViva = (info: Partial<InfoTrava>, vivo: (pid: number) => boolean, orfao: (f: { pid: number; inicio: number }) => boolean): boolean =>
  info.pid !== undefined && (vivo(info.pid) || (info.filho !== undefined && orfao(info.filho)))

export function dormir(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Remove sem lançar: no Windows o arquivo preso (antivírus, indexador) faz o rmdir falhar com ENOTEMPTY/EBUSY/EPERM.
 * Sobra temporária começa com "." e `pastas()` a ignora; sobra de vaga ou de espera fica visível e é recuperada como de dono morto.
 */
export function removerMelhorEsforco(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch {
    // a sobra é tratada como acima
  }
}

/** Cria `dir` já com os arquivos (pasta temporária + rename): ou existe inteira, ou não existe. Falso se já estava ocupado. */
export function publicarArquivos(dir: string, arquivos: Record<string, string>): boolean {
  const pai = dirname(dir)
  mkdirSync(pai, { recursive: true })
  const tmp = join(pai, `.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmp)
  try {
    for (const [nome, conteudo] of Object.entries(arquivos)) writeFileSync(join(tmp, nome), conteudo)
    renameSync(tmp, dir)
    return true
  } catch {
    removerMelhorEsforco(tmp)
    return false
  }
}

export const publicar = (dir: string, info: Partial<InfoTrava> & { pid: number }): boolean =>
  publicarArquivos(dir, { 'info.json': JSON.stringify(info) })

/** Regrava campos da trava ou da espera (arquivo temporário + rename, o leitor concorrente nunca vê a trava pela metade). Best effort. */
export function anotar(dir: string, campos: Partial<InfoTrava>): void {
  try {
    const info = lerInfo(dir)
    if (!info) return
    const tmp = join(dir, `.info-${process.pid}-${Math.random().toString(36).slice(2)}`)
    writeFileSync(tmp, JSON.stringify({ ...info, ...campos }))
    renameSync(tmp, join(dir, 'info.json'))
  } catch {
    // sem a anotação fica o que já estava gravado (na trava, só o dono)
  }
}

export function lerInfo(dir: string): Partial<InfoTrava> | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'info.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Tira uma trava cujo dono morreu. Se no meio o dono mudou, devolve a trava (a janela é de milissegundos). */
// shortcut: fora do Windows o órfão de dono morto não é detectado (a vaga é recuperada com ele vivo); upgrade: grupo de processos.
export function recuperar(dir: string, pidEsperado: number | null): void {
  const morta = join(dirname(dir), `.morta-${process.pid}-${Math.random().toString(36).slice(2)}`)
  try {
    renameSync(dir, morta)
  } catch {
    return
  }
  if ((lerInfo(morta)?.pid ?? null) !== pidEsperado) {
    try {
      renameSync(morta, dir)
      return
    } catch {
      // outro já ocupou a vaga: a trava devolvida é descartada
    }
  }
  removerMelhorEsforco(morta)
}

/** Trava entre processos em `dir` (dono = este pid); retira a de dono morto. Falso se passou de `limiteMs` esperando. */
export function adquirir(dir: string, limiteMs: number, vivo: (pid: number) => boolean = vivoPadrao): boolean {
  const fim = Date.now() + limiteMs
  while (!publicar(dir, { pid: process.pid })) {
    const dono = lerInfo(dir)?.pid ?? null
    if (dono === null || !vivo(dono)) recuperar(dir, dono)
    if (Date.now() > fim) return false
    dormir(20)
  }
  return true
}

/** Pega a primeira vaga livre de `base` (1..n), recuperando as de dono morto sem órfão vivo. Devolve o número da vaga. */
export function tomarVaga(base: string, n: number, info: InfoTrava, vivo: (pid: number) => boolean, orfao: (f: { pid: number; inicio: number }) => boolean = orfaoVivo): number | null {
  for (let i = 1; i <= n; i++) {
    const dir = join(base, String(i))
    if (publicar(dir, info)) return i
    const atual = lerInfo(dir)
    const dono = atual?.pid ?? null
    if (dono === null || !travaViva(atual!, vivo, orfao)) {
      recuperar(dir, dono)
      if (publicar(dir, info)) return i
    }
  }
  return null
}

export function soltarVaga(base: string, vaga: number): void {
  removerMelhorEsforco(join(base, String(vaga)))
}

/** Apaga registros de espera de processos que morreram. */
export function limparEsperaMorta(p: Paths, vivo: (pid: number) => boolean = vivoPadrao): void {
  for (const d of pastas(p.espera)) if (!vivo(Number(d))) removerMelhorEsforco(join(p.espera, d))
}

/** Recupera travas e esperas mortas de todas as filas, inclusive o teto da máquina. */
export function limparTravasMortas(p: Paths, vivo: (pid: number) => boolean = vivoPadrao, orfao: (f: { pid: number; inicio: number }) => boolean = orfaoVivo): void {
  limparEsperaMorta(p, vivo)
  for (const fila of pastas(p.fila)) {
    for (const vaga of pastas(join(p.fila, fila))) {
      const dir = join(p.fila, fila, vaga)
      const info = lerInfo(dir)
      const dono = info?.pid ?? null
      if (dono === null || !travaViva(info!, vivo, orfao)) recuperar(dir, dono)
    }
  }
}

const pastas = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)
  } catch {
    return []
  }
}

const linha = (info: Partial<InfoTrava>, estado: TesteNaFila['estado'], vaga: number | null, desde: number | null): TesteNaFila => ({
  pid: info.pid ?? null,
  estado,
  recurso: info.recurso ?? null,
  worktree: info.worktree ?? null,
  projeto: info.projeto ?? null,
  comando: info.comando ?? null,
  fila: info.fila ?? null,
  vaga,
  desde_ts: desde
})

/** Testes na fila: execucao, aguardando, parado (dono morto e sem órfão vivo); cada grupo do mais antigo. */
export function listarTestes(p: Paths, vivo: (pid: number) => boolean = vivoPadrao, orfao: (f: { pid: number; inicio: number }) => boolean = orfaoVivo): TesteNaFila[] {
  const esperando: TesteNaFila[] = []
  for (const d of pastas(p.espera)) {
    const info = lerInfo(join(p.espera, d))
    if (info) esperando.push(linha({ ...info, pid: info.pid ?? Number(d) }, vivo(Number(d)) ? 'aguardando' : 'parado', null, info.inicio ?? null))
  }
  // Quem espera outra vaga (ex.: o teto) e já segura esta aparece só como aguardando.
  const pidsEsperando = new Set(esperando.map((t) => t.pid))

  const rodando: TesteNaFila[] = []
  for (const fila of pastas(p.fila)) {
    if (fila === TETO) continue
    for (const v of pastas(join(p.fila, fila))) {
      const info = lerInfo(join(p.fila, fila, v))
      if (!info || pidsEsperando.has(info.pid ?? null)) continue
      rodando.push(linha(info, travaViva(info, vivo, orfao) ? 'execucao' : 'parado', Number(v) || null, info.inicio ?? null))
    }
  }

  const ordem = { execucao: 0, aguardando: 1, parado: 2 }
  return [...rodando, ...esperando].sort((a, b) => ordem[a.estado] - ordem[b.estado] || (a.desde_ts ?? 0) - (b.desde_ts ?? 0))
}
