import { carregar } from '../../core/config.ts'
import { ramLivreGb } from '../../core/pool/memoria.ts'
import { encerradoNoOrca, livres, pegar, recuperar, soltar, trocar } from '../../core/pool/vagas.ts'
import { type Ctx, caminhos, comJson, donoValido, emitir, SemVaga, Uso } from '../ctx.ts'
import { textoOcupacao, textosPara } from '../textos.ts'

/** agent-pool slot take <conta> <dono> | swap <prov> <dispatch> | release <dispatch> | free */
export async function slot(ctx: Ctx, args: string[]): Promise<number> {
  const t = textosPara(ctx.env)
  const { json, resto } = comJson(args)
  const [sub, a, b] = resto
  const p = caminhos(ctx)
  const c = carregar(p)
  if (sub === 'take') {
    if (!a || !c.pool.contas.some(x => x.nome === a)) throw new Uso(`${t.contaDesconhecida}: ${a ?? t.vazio}`)
    const ram = c.pool.ramMinGb > 0 ? await ramLivreGb(ctx.orca) : null
    const r = await pegar(p, c, a, donoValido(ctx, b), ctx.agora(), ram)
    if (r !== 'ok') throw new SemVaga(`${t.semVaga}: ${a} (${t.motivos[r] ?? r})`)
    emitir(ctx, json, { conta: a, dono: b }, `ok ${a} ${b}`)
  } else if (sub === 'swap') {
    if (!(await trocar(p, donoValido(ctx, a), donoValido(ctx, b), ctx.agora()))) throw new SemVaga(t.reservaAusente(a!))
    emitir(ctx, json, { dono: b }, `ok ${b}`)
  } else if (sub === 'release') {
    await soltar(p, donoValido(ctx, a))
    emitir(ctx, json, { dono: a }, `ok ${t.liberada} ${a}`)
  } else if (sub === 'free') {
    await recuperar(p, encerradoNoOrca(ctx.orca), ctx.agora())
    const l = await livres(p, c, ctx.agora())
    emitir(
      ctx,
      json,
      l,
      l.map(x => (x.inativa ? `${x.conta} ${t.inativa}` : `${x.conta} ${textoOcupacao(ctx.env, x, 'livres')}`)).join(' · '),
    )
  } else throw new Uso(`${t.uso}: agent-pool slot take <account> <owner> | swap <reservation> <dispatch> | release <dispatch> | free`)
  return 0
}
