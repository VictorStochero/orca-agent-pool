import { carregar } from '../../core/config.ts'
import { listarTestes } from '../../core/fila/travas.ts'
import { livres } from '../../core/pool/vagas.ts'
import { medirTodas } from '../../core/medidas/cache.ts'
import { caminhos, comJson, emitir, type Ctx } from '../ctx.ts'
import { ocupacao, textosPara } from '../textos.ts'

/** agent-pool status [--json] */
export async function status(ctx: Ctx, args: string[]): Promise<number> {
  const t = textosPara(ctx.env)
  const { json } = comJson(args)
  const p = caminhos(ctx)
  const c = carregar(p)
  const agora = ctx.agora()
  const testes = listarTestes(p)
  const medidas = await medirTodas(c, p, ctx.orca, { home: ctx.home, fetch: ctx.fetch, agora })
  const contas = livres(p, c, agora).map((l) => ({ ...l, medida: medidas.find((m) => m.conta === l.conta) ?? null }))
  const n = (e: string) => testes.filter((t) => t.estado === e).length
  const conta = (x: (typeof contas)[number]) =>
    x.inativa ? `${x.conta} ${t.inativa}` : `${x.conta} ${ocupacao(ctx.env, x, 'emUso')}`
  const linha =
    `${t.fila} ${t.modos[c.fila.modo]}: ${n('execucao')} ${t.rodando}, ${n('aguardando')} ${t.aguardando}, ${n('parado')} ${t.parados}` +
    ` · pool ${t.modos[c.pool.escolha]}: ${contas.length ? contas.map(conta).join(', ') : t.nenhumaConta}`
  emitir(ctx, json, { fila: { modo: c.fila.modo, testes }, pool: { escolha: c.pool.escolha, teto: c.pool.teto, contas } }, linha)
  return 0
}
