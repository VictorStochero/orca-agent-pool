import { carregar } from '../../core/config.ts'
import { medirTodas } from '../../core/medidas/cache.ts'
import { motivoNaoConfigurada } from '../../core/motivo.ts'
import { caminhoDeBusca } from '../../core/orca.ts'
import { type Ctx, caminhos, comJson, emitir, Uso } from '../ctx.ts'
import { textosPara } from '../textos.ts'

/** agent-pool measure [conta] — mede agora, sem usar o cache. */
export async function measure(ctx: Ctx, args: string[]): Promise<number> {
  const t = textosPara(ctx.env)
  const { json, resto } = comJson(args)
  const p = caminhos(ctx)
  const c = carregar(p)
  if (resto[0] && !c.pool.contas.some(x => x.nome === resto[0])) throw new Uso(`${t.contaDesconhecida}: ${resto[0]}`)
  const ms = await medirTodas(
    c,
    p,
    ctx.orca,
    { home: ctx.home, fetch: ctx.fetch, agora: ctx.agora(), path: await caminhoDeBusca(ctx.env) },
    0,
    resto[0],
  )
  const motivo = (erro?: string) => {
    const m = motivoNaoConfigurada(erro)
    return m ? `: ${t.motivosNaoConfigurada[m.tipo](m.valor)}` : erro ? `: ${erro}` : ''
  }
  const pct = (v: number | null) => (v === null ? '?' : `${Math.round(v)}%`)
  const linha = (m: (typeof ms)[number]): string => {
    const detalhe = m.erro ? ` (${m.erro})` : ''
    switch (m.estado) {
      case 'ok':
        return `${m.conta}: 5h ${pct(m.curta)} · ${t.semanal} ${pct(m.longa)}`
      case 'nao_configurada':
        return `${m.conta}: ${t.naoConfigurada}${motivo(m.erro)}`
      case 'sem_login':
        return `${m.conta}: ${t.semLogin}${m.acao ? ` → ${m.acao}` : ''}`
      case 'erro':
        return `${m.conta}: ${t.erro}${detalhe}`
      default:
        return `${m.conta}: ${t.semMedida}${detalhe}`
    }
  }
  emitir(ctx, json, ms, ms.map(linha).join(' · '))
  return 0
}
