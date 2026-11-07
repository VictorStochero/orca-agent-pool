import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carregar, ErroConfig } from '../../core/config.ts'
import { versao } from '../../core/index.ts'
import { caminhoLancador, estadoLancador, lancadorEsperado } from '../../core/lancador.ts'
import { ramLivreGb } from '../../core/pool/memoria.ts'
import { agentesDaSkill, situacaoSkill, skillPronta } from '../../core/skill.ts'
import { AGENTES_HOOK, type AgenteHook, agentesComHook, estadoHooks, type Pastas, pastasDasContas, soAtivas } from '../../hooks/comum.ts'
import { type Ctx, caminhos, comJson, emitir } from '../ctx.ts'
import { erroConfig, textosPara } from '../textos.ts'

const RAIZ_PLUGIN = fileURLToPath(new URL('../../../', import.meta.url))
const ORIGEM_SKILL = join(RAIZ_PLUGIN, 'skill', 'agent-pool')

/** agent-pool doctor — requisitos, lançador, skill e hooks (somente leitura). */
export async function doctor(ctx: Ctx, args: string[]): Promise<number> {
  const t = textosPara(ctx.env)
  const { json } = comJson(args)
  const p = caminhos(ctx)
  const itens: { item: string; ok: boolean; detalhe?: string }[] = []
  let agentes: readonly AgenteHook[] = AGENTES_HOOK
  let pastas: Pastas = {}
  let agentesSkill: string[] = []
  try {
    const c = carregar(p)
    const ativas = soAtivas(c)
    agentes = agentesComHook(ativas)
    pastas = pastasDasContas(ativas, ctx.home)
    agentesSkill = agentesDaSkill(ativas)
    itens.push({ item: 'config', ok: true, detalhe: `${c.pool.contas.length} ${t.contas}` })
  } catch (e) {
    itens.push({ item: 'config', ok: false, detalhe: e instanceof ErroConfig ? erroConfig(ctx.env, e.erros) : (e as Error).message })
  }
  // O `diagnostics` precisa do app em execução; o `--version` responde mesmo com o Orca fechado.
  itens.push({ item: 'orca', ok: (await ramLivreGb(ctx.orca)) !== null })
  itens.push({ item: 'launcher', ok: estadoLancador(lancadorEsperado(p.bin, RAIZ_PLUGIN)) === 'ok' })
  const skill = situacaoSkill(ORIGEM_SKILL, ctx.home, versao, agentesSkill, pastas)
  itens.push({ item: 'skill', ok: skillPronta(skill.estado) })
  for (const h of estadoHooks(ctx.home, caminhoLancador(p.bin), pastas).filter(x => agentes.includes(x.agente as AgenteHook))) {
    itens.push({ item: `hook ${h.agente}`, ok: h.estado === 'instalado', detalhe: h.erro ? (t.errosHook[h.erro] ?? h.erro) : h.pasta })
  }
  emitir(
    ctx,
    json,
    itens,
    itens
      .map(i => `${i.ok ? 'ok   ' : t.falta} ${i.item === 'launcher' ? t.lancador : i.item}${i.detalhe ? ` (${i.detalhe})` : ''}`)
      .join(' · '),
  )
  return itens.every(i => i.ok) ? 0 : 1
}
