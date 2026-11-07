import { atualizarConfig, carregar } from '../../core/config.ts'
import { aplicar } from '../../core/config-chaves.ts'
import { type Ctx, caminhos, Uso } from '../ctx.ts'
import { textosPara } from '../textos.ts'

/** agent-pool config get [chave.pontilhada] | set chave=valor … */
export async function config(ctx: Ctx, args: string[]): Promise<number> {
  const t = textosPara(ctx.env)
  const [sub, ...resto] = args
  const p = caminhos(ctx)
  if (sub === 'get') {
    let v: unknown = carregar(p)
    for (const k of (resto[0] ?? '').split('.').filter(Boolean)) v = (v as Record<string, unknown> | undefined)?.[k]
    if (v === undefined) throw new Uso(`${t.chaveDesconhecida}: ${resto[0]}`)
    ctx.out(typeof v === 'string' ? v : JSON.stringify(v))
    return 0
  }
  if (sub === 'set' && resto.length) {
    const mudancas: Record<string, string> = {}
    for (const par of resto) {
      const i = par.indexOf('=')
      if (i < 1) throw new Uso(`${t.esperavaPar}: ${par}`)
      mudancas[par.slice(0, i)] = par.slice(i + 1)
    }
    await atualizarConfig(p, c => aplicar(c, mudancas))
    ctx.out(`ok ${Object.keys(mudancas).length} ${t.alteracoes}`)
    return 0
  }
  throw new Uso(`${t.uso}: agent-pool config get [${t.chave}] | set ${t.chave}=${t.valor} …`)
}
