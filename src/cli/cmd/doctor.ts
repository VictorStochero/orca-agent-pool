import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { carregar, ErroConfig } from '../../core/config.ts'
import { ramLivreGb } from '../../core/pool/memoria.ts'
import { AGENTES_HOOK, agentesComHook, estadoHooks, pastasDasContas, type AgenteHook, type Pastas } from '../../hooks/comum.ts'
import { destinoSkill } from '../../core/paths.ts'
import { caminhos, comJson, emitir, type Ctx } from '../ctx.ts'
import { erroConfig, textosPara } from '../textos.ts'

/** agent-pool doctor — requisitos, lançador, skill e hooks (somente leitura). */
export async function doctor(ctx: Ctx, args: string[]): Promise<number> {
  const t = textosPara(ctx.env)
  const { json } = comJson(args)
  const p = caminhos(ctx)
  const itens: { item: string; ok: boolean; detalhe?: string }[] = []
  let agentes: readonly AgenteHook[] = AGENTES_HOOK
  let pastas: Pastas = {}
  try {
    const c = carregar(p)
    agentes = agentesComHook(c)
    pastas = pastasDasContas(c)
    itens.push({ item: 'config', ok: true, detalhe: `${c.pool.contas.length} ${t.contas}` })
  } catch (e) {
    itens.push({ item: 'config', ok: false, detalhe: e instanceof ErroConfig ? erroConfig(ctx.env, e.erros) : (e as Error).message })
  }
  itens.push({ item: 'orca', ok: (await ramLivreGb(ctx.orca)) !== null })
  itens.push({ item: 'launcher', ok: existsSync(join(p.bin, 'agent-pool')) })
  itens.push({ item: 'skill', ok: existsSync(join(destinoSkill(ctx.home), 'SKILL.md')) })
  for (const h of estadoHooks(ctx.home, pastas).filter((x) => agentes.includes(x.agente as AgenteHook))) {
    itens.push({ item: `hook ${h.agente}`, ok: h.estado === 'instalado', detalhe: h.erro ? (t.errosHook[h.erro] ?? h.erro) : h.pasta })
  }
  emitir(ctx, json, itens, itens.map((i) => `${i.ok ? 'ok   ' : t.falta} ${i.item === 'launcher' ? t.lancador : i.item}${i.detalhe ? ` (${i.detalhe})` : ''}`).join(' · '))
  return itens.every((i) => i.ok) ? 0 : 1
}
