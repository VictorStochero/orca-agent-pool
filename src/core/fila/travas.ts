import { join } from 'node:path'
import type { Paths } from '../paths.ts'
import {
  type Filho,
  type InfoTrava,
  lerInfo,
  pastas,
  publicar,
  removerMelhorEsforco,
  retirar,
  tirarTravaMorta,
  vivoPadrao,
} from '../trava.ts'
import { aquecerOrfaos, orfaoEmCache } from './orfao.ts'

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
  saida: NonNullable<InfoTrava['saida']> | null
}

/** Pasta do teto global dentro de state/fila; fica de fora da listagem (o mesmo teste já aparece na fila dele). */
export const TETO = '_teto'

/** Dono vivo, ou dono morto cujo filho lançado segue rodando. */
const travaViva = (info: Partial<InfoTrava>, vivo: (pid: number) => boolean, orfao: (f: Filho) => boolean): boolean =>
  info.pid !== undefined && (vivo(info.pid) || (info.filho != null && orfao(info.filho)))

/** Pega a primeira vaga livre de `base` (1..n), recuperando as de dono morto sem órfão vivo. Devolve o número da vaga. */
export function tomarVaga(
  base: string,
  n: number,
  info: InfoTrava,
  vivo: (pid: number) => boolean,
  orfao: (f: Filho) => boolean = orfaoEmCache,
): number | null {
  for (let i = 1; i <= n; i++) {
    const dir = join(base, String(i))
    if (publicar(dir, info)) return i
    const atual = lerInfo(dir)
    const dono = atual?.pid ?? null
    if (dono === null || !travaViva(atual!, vivo, orfao)) {
      tirarTravaMorta(dir, dono)
      if (publicar(dir, info)) return i
    }
  }
  return null
}

export function soltarVaga(base: string, vaga: number): void {
  retirar(join(base, String(vaga)))
}

/** Apaga registros de espera de processos que morreram. */
export function limparEsperaMorta(p: Paths, vivo: (pid: number) => boolean = vivoPadrao): void {
  for (const d of pastas(p.espera)) if (!vivo(Number(d))) removerMelhorEsforco(join(p.espera, d))
}

/** Recupera travas e esperas mortas de todas as filas, inclusive o teto da máquina. */
export function limparTravasMortas(
  p: Paths,
  vivo: (pid: number) => boolean = vivoPadrao,
  orfao: (f: Filho) => boolean = orfaoEmCache,
): void {
  limparEsperaMorta(p, vivo)
  for (const fila of pastas(p.fila)) {
    for (const vaga of pastas(join(p.fila, fila))) {
      const dir = join(p.fila, fila, vaga)
      const info = lerInfo(dir)
      const dono = info?.pid ?? null
      if (dono === null || !travaViva(info!, vivo, orfao)) tirarTravaMorta(dir, dono)
    }
  }
}

/** `limparTravasMortas` depois de consultar os órfãos sem bloquear o processo (CLI e worker). */
export async function limparTravasMortasAsync(p: Paths, vivo: (pid: number) => boolean = vivoPadrao): Promise<void> {
  await aquecerOrfaos(p, vivo)
  limparTravasMortas(p, vivo)
}

/** `listarTestes` depois de consultar os órfãos sem bloquear o processo (CLI e worker). */
export async function listarTestesAsync(p: Paths, vivo: (pid: number) => boolean = vivoPadrao): Promise<TesteNaFila[]> {
  await aquecerOrfaos(p, vivo)
  return listarTestes(p, vivo)
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
  desde_ts: desde,
  saida: info.saida ?? null,
})

/** Testes na fila: execucao, aguardando, parado (dono morto e sem órfão vivo); cada grupo do mais antigo. */
export function listarTestes(
  p: Paths,
  vivo: (pid: number) => boolean = vivoPadrao,
  orfao: (f: Filho) => boolean = orfaoEmCache,
): TesteNaFila[] {
  const esperando: TesteNaFila[] = []
  for (const d of pastas(p.espera)) {
    const info = lerInfo(join(p.espera, d))
    if (info)
      esperando.push(linha({ ...info, pid: info.pid ?? Number(d) }, vivo(Number(d)) ? 'aguardando' : 'parado', null, info.inicio ?? null))
  }
  // Quem espera outra vaga (ex.: o teto) e já segura esta aparece só como aguardando.
  const pidsEsperando = new Set(esperando.map(t => t.pid))

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
