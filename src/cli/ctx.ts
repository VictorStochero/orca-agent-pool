import { paths, type Paths } from '../core/paths.ts'
import type { OrcaCli } from '../core/tipos.ts'
import { textosPara } from './textos.ts'

export type Ctx = {
  home: string
  env: NodeJS.ProcessEnv
  orca: OrcaCli
  fetch: typeof fetch
  cwd: string
  agora: () => number
  stdin: () => Promise<string>
  out: (s: string) => void
  err: (s: string) => void
}

export const caminhos = (ctx: Ctx): Paths => paths(ctx.home)

/** Uma linha legível, ou o objeto em JSON com `--json`. */
export function emitir(ctx: Ctx, json: boolean, objeto: unknown, linha: string): void {
  ctx.out(json ? JSON.stringify(objeto) : linha)
}

/** Separa `--json` do resto. */
export function comJson(args: string[]): { json: boolean; resto: string[] } {
  return { json: args.includes('--json'), resto: args.filter((a) => a !== '--json') }
}

export class Uso extends Error {}
export class SemVaga extends Error {}

export const DONO = /^[a-zA-Z0-9_-]+$/
export const donoValido = (ctx: Ctx, s: string | undefined): string => {
  const t = textosPara(ctx.env)
  if (!s || !DONO.test(s)) throw new Uso(t.nomeInvalido(s ?? t.vazio))
  return s
}
