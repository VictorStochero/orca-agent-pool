import { ErroConfig } from '../core/config.ts'
import { TravaOcupada } from '../core/pool/vagas.ts'
import { config } from './cmd/config.ts'
import { doctor } from './cmd/doctor.ts'
import { second, writer } from './cmd/escolha.ts'
import { hook } from './cmd/hook.ts'
import { measure } from './cmd/measure.ts'
import { slot } from './cmd/slot.ts'
import { status } from './cmd/status.ts'
import { test } from './cmd/test.ts'
import { SemVaga, Uso, type Ctx } from './ctx.ts'
import { erroConfig, textosPara } from './textos.ts'

const COMANDOS: Record<string, (ctx: Ctx, args: string[]) => Promise<number>> = { test, writer, second, slot, status, config, measure, doctor, hook }

/** Roda um comando e devolve o código de saída: 0 ok, 2 uso inválido, 75 sem vaga. */
export async function executar(argv: string[], ctx: Ctx): Promise<number> {
  const t = textosPara(ctx.env)
  const [nome, ...args] = argv
  const cmd = nome ? COMANDOS[nome] : undefined
  if (!cmd) {
    ctx.err(t.ajuda)
    return nome === '--help' || nome === '-h' ? 0 : 2
  }
  try {
    return await cmd(ctx, args)
  } catch (e) {
    const falha = (codigo: number, msg: string) => (ctx.err(msg), codigo)
    if (e instanceof SemVaga) return falha(75, e.message)
    if (e instanceof TravaOcupada) return falha(75, t.travaOcupada)
    if (e instanceof ErroConfig) return falha(2, erroConfig(ctx.env, e.erros))
    if (e instanceof Uso) return falha(2, e.message)
    return falha(1, `${t.erro}: ${(e as Error).message}`)
  }
}
