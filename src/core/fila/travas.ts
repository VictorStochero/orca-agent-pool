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
}

export type TesteNaFila = {
  pid: number | null
  estado: 'execucao' | 'aguardando' | 'parado'
  recurso: string | null
  worktree: string | null
  projeto: string | null
  comando: string | null
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

export function dormir(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
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
    rmSync(tmp, { recursive: true, force: true })
    return false
  }
}

export const publicar = (dir: string, info: Partial<InfoTrava> & { pid: number }): boolean =>
  publicarArquivos(dir, { 'info.json': JSON.stringify(info) })

export function lerInfo(dir: string): Partial<InfoTrava> | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'info.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Tira uma trava cujo dono morreu. Se no meio o dono mudou, devolve a trava (a janela é de milissegundos). */
// shortcut: processo-filho órfão do dono morto não é encerrado; upgrade: gravar a identidade do filho e matar a árvore na recuperação.
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
  rmSync(morta, { recursive: true, force: true })
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

/** Pega a primeira vaga livre de `base` (1..n), recuperando as de dono morto. Devolve o número da vaga. */
export function tomarVaga(base: string, n: number, info: InfoTrava, vivo: (pid: number) => boolean): number | null {
  for (let i = 1; i <= n; i++) {
    const dir = join(base, String(i))
    if (publicar(dir, info)) return i
    const dono = lerInfo(dir)?.pid ?? null
    if (dono === null || !vivo(dono)) {
      recuperar(dir, dono)
      if (publicar(dir, info)) return i
    }
  }
  return null
}

export function soltarVaga(base: string, vaga: number): void {
  rmSync(join(base, String(vaga)), { recursive: true, force: true })
}

/** Apaga registros de espera de processos que morreram. */
export function limparEsperaMorta(p: Paths, vivo: (pid: number) => boolean = vivoPadrao): void {
  for (const d of pastas(p.espera)) if (!vivo(Number(d))) rmSync(join(p.espera, d), { recursive: true, force: true })
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
  vaga,
  desde_ts: desde
})

/** Testes na fila: execucao, aguardando, parado (dono morto); cada grupo do mais antigo. */
export function listarTestes(p: Paths, vivo: (pid: number) => boolean = vivoPadrao): TesteNaFila[] {
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
      rodando.push(linha(info, info.pid !== undefined && vivo(info.pid) ? 'execucao' : 'parado', Number(v) || null, info.inicio ?? null))
    }
  }

  const ordem = { execucao: 0, aguardando: 1, parado: 2 }
  return [...rodando, ...esperando].sort((a, b) => ordem[a.estado] - ordem[b.estado] || (a.desde_ts ?? 0) - (b.desde_ts ?? 0))
}
