import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { gravarAtomico } from './atomico.ts'

/** Processo lançado pelo dono e hora (ms) logo após o spawn; sobrevive ao dono morto (ver `orfaoVivo`). */
export type Filho = { pid: number; inicio: number }

export type InfoTrava = {
  pid: number
  /** ms desde a época: início da execução (trava) ou da espera (registro de espera). */
  inicio: number
  recurso: string | null
  worktree: string | null
  projeto: string | null
  comando: string | null
  fila: string
  filho?: Filho
}

export function vivoPadrao(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export const esperar = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Remove sem lançar: no Windows o arquivo preso (antivírus, indexador) faz o rmdir falhar com ENOTEMPTY/EBUSY/EPERM.
 * Sobra temporária (`.tmp-*`, `.morta-*`) começa com "." e `pastas()` a ignora; sobra de vaga ou de espera removida direto fica visível e é recuperada como de dono morto.
 */
export function removerMelhorEsforco(dir: string): void {
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    })
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

/** Regrava campos da trava ou da espera sem o leitor concorrente ver a trava pela metade. Best effort. */
export function anotar(dir: string, campos: Partial<InfoTrava>): void {
  try {
    const info = lerInfo(dir)
    if (!info) return
    gravarAtomico(join(dir, 'info.json'), JSON.stringify({ ...info, ...campos }))
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

/** Subpastas de `dir` que não começam com ".": as temporárias de `publicarArquivos` ficam de fora. */
export const pastas = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name)
  } catch {
    return []
  }
}

/** Sobra de `.retirando-*` mais velha que isto é de uma retirada interrompida. */
const RETIRADA_VELHA_MS = 5_000

/**
 * Tira `dir` por rename e apaga a cópia: um `publicar` que caia depois do rename cria outra pasta, que a remoção não alcança.
 * No Windows o rename falha (EPERM) com um arquivo da pasta aberto por outro processo: aí remove no lugar, que não tem a janela do POSIX.
 */
export function retirar(dir: string): void {
  const morta = join(dirname(dir), `.morta-${process.pid}-${Math.random().toString(36).slice(2)}`)
  try {
    renameSync(dir, morta)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') removerMelhorEsforco(dir)
    return
  }
  removerMelhorEsforco(morta)
}

/**
 * Tira uma trava cujo dono morreu, só se o dono ainda for `pidEsperado`. A retirada é serializada por uma trava curta
 * ao lado: quem publica só cria `dir` quando ele não existe, então ninguém o troca entre a releitura e a remoção.
 * Pasta sem `info.json` e recém-mexida é uma soltura ou publicação em curso: fica.
 */
// shortcut: fora do Windows o órfão de dono morto não é detectado (a vaga é recuperada com ele vivo); upgrade: grupo de processos.
export function tirarTravaMorta(dir: string, pidEsperado: number | null): void {
  const retirando = join(dirname(dir), `.retirando-${basename(dir)}`)
  if (!publicar(retirando, { pid: process.pid })) {
    if (idadeMs(retirando) > RETIRADA_VELHA_MS) removerMelhorEsforco(retirando)
    return
  }
  try {
    const info = lerInfo(dir)
    if (info === null && idadeMs(dir) <= RETIRADA_VELHA_MS) return
    if ((info?.pid ?? null) === pidEsperado) retirar(dir)
  } finally {
    removerMelhorEsforco(retirando)
  }
}

function idadeMs(caminho: string): number {
  try {
    return Date.now() - statSync(caminho).mtimeMs
  } catch {
    return 0
  }
}

export class TravaOcupada extends Error {}

/** Roda `fn` com a trava entre processos em `dir` (dono = este pid), soltando-a no fim; `TravaOcupada` se passar de `limiteMs` esperando. */
export async function comTrava<T>(dir: string, limiteMs: number, fn: () => T | Promise<T>): Promise<T> {
  if (!(await adquirir(dir, limiteMs))) throw new TravaOcupada()
  try {
    return await fn()
  } finally {
    retirar(dir)
  }
}

/** Trava entre processos em `dir` (dono = este pid); retira a de dono morto. Falso se passou de `limiteMs` esperando. */
export async function adquirir(dir: string, limiteMs: number, vivo: (pid: number) => boolean = vivoPadrao): Promise<boolean> {
  const fim = Date.now() + limiteMs
  while (!tentarAdquirir(dir, vivo)) {
    if (Date.now() > fim) return false
    await esperar(20)
  }
  return true
}

/** Uma tentativa: publica a trava ou, ocupada por dono morto, a retira para a próxima. */
function tentarAdquirir(dir: string, vivo: (pid: number) => boolean): boolean {
  if (publicar(dir, { pid: process.pid })) return true
  const dono = lerInfo(dir)?.pid ?? null
  if (dono === null || !vivo(dono)) tirarTravaMorta(dir, dono)
  return false
}
