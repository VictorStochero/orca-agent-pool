import { carregar } from '../../core/config.ts'
import { listarTestes } from '../../core/fila/travas.ts'
import { medidaEfetiva } from '../../core/pool/modelo.ts'
import { livres } from '../../core/pool/vagas.ts'
import { medirTodas } from '../../core/medidas/cache.ts'
import { caminhoDeBusca } from '../../core/orca.ts'
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
  const medidas = await medirTodas(c, p, ctx.orca, { home: ctx.home, fetch: ctx.fetch, agora, path: await caminhoDeBusca(ctx.env) })
  const contas = livres(p, c, agora).map((l) => {
    const ct = c.pool.contas.find((x) => x.nome === l.conta)! // `livres` sai de c.pool.contas
    const m = medidas.find((x) => x.conta === l.conta)
    return { ...l, medida: m ? medidaEfetiva(ct, m) : null }
  })
  const n = (e: string) => testes.filter((t) => t.estado === e).length
  const conta = (x: (typeof contas)[number]) =>
    x.inativa ? `${x.conta} ${t.inativa}`
      : x.medida?.estado === 'nao_configurada' ? `${x.conta} (${t.naoConfigurada})`
      : `${x.conta} ${ocupacao(ctx.env, x, 'emUso')}`
  const linha =
    `${t.fila} ${t.modos[c.fila.modo]}: ${n('execucao')} ${t.rodando}, ${n('aguardando')} ${t.aguardando}, ${n('parado')} ${t.parados}` +
    ` · pool ${t.modos[c.pool.escolha]}: ${contas.length ? contas.map(conta).join(', ') : t.nenhumaConta}`
  emitir(ctx, json, { fila: { modo: c.fila.modo, testes }, pool: { escolha: c.pool.escolha, teto: c.pool.teto, contas } }, linha)
  return 0
}
