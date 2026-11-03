import { carregar } from '../../core/config.ts'
import { medirTodas } from '../../core/medidas/cache.ts'
import { caminhoDeBusca } from '../../core/orca.ts'
import { motivoNaoConfigurada } from '../../core/motivo.ts'
import { caminhos, comJson, emitir, Uso, type Ctx } from '../ctx.ts'
import { textosPara } from '../textos.ts'

/** agent-pool measure [conta] — mede agora, sem usar o cache. */
export async function measure(ctx: Ctx, args: string[]): Promise<number> {
  const t = textosPara(ctx.env)
  const { json, resto } = comJson(args)
  const p = caminhos(ctx)
  const c = carregar(p)
  if (resto[0] && !c.pool.contas.some((x) => x.nome === resto[0])) throw new Uso(`${t.contaDesconhecida}: ${resto[0]}`)
  const todas = await medirTodas(c, p, ctx.orca, { home: ctx.home, fetch: ctx.fetch, agora: ctx.agora(), path: await caminhoDeBusca(ctx.env) }, 0)
  const ms = todas.filter((m) => !resto[0] || m.conta === resto[0])
  const motivo = (erro?: string) => {
    const m = motivoNaoConfigurada(erro)
    return m ? `: ${t.motivosNaoConfigurada[m.tipo](m.valor)}` : erro ? `: ${erro}` : ''
  }
  const pct = (v: number | null) => (v === null ? '?' : `${Math.round(v)}%`)
  const linha = (m: (typeof ms)[number]) =>
    m.estado === 'ok' ? `${m.conta}: 5h ${pct(m.curta)} · ${t.semanal} ${pct(m.longa)}`
      : m.estado === 'nao_configurada' ? `${m.conta}: ${t.naoConfigurada}${motivo(m.erro)}`
      : m.estado === 'sem_login' ? `${m.conta}: ${t.semLogin}${m.acao ? ` → ${m.acao}` : ''}`
      : `${m.conta}: ${m.estado === 'erro' ? t.erro : t.semMedida}${m.erro ? ` (${m.erro})` : ''}`
  emitir(ctx, json, ms, ms.map(linha).join(' · '))
  return 0
}
