import { carregar } from '../../core/config.ts'
import { detectarExecutor } from '../../core/fila/executores.ts'
import { rodarNaFila } from '../../core/fila/rodar.ts'
import { type Ctx, caminhos, Uso } from '../ctx.ts'
import { textosPara } from '../textos.ts'

/** agent-pool test [-- comando] */
export async function test(ctx: Ctx, args: string[]): Promise<number> {
  const t = textosPara(ctx.env)
  if (args.length && args[0] !== '--') throw new Uso(`${t.uso}: agent-pool test [-- ${t.comando}]`)
  if (args[0] === '--' && args.length === 1) throw new Uso(`${t.uso}: agent-pool test -- <${t.comando}>`)
  if (!args.length && !detectarExecutor(ctx.cwd)) throw new Uso(t.stackAusente)
  const p = caminhos(ctx)
  return rodarNaFila({
    dir: ctx.cwd,
    comando: args.length ? args.slice(1) : undefined,
    config: carregar(p).fila,
    lerConfig: () => carregar(p).fila,
    p,
    env: ctx.env,
    avisar: e => ctx.err(t.avisoFila(e)),
  })
}
