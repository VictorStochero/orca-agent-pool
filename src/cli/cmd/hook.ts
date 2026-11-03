import { join } from 'node:path'
import { decidir } from '../../core/hook/decisao.ts'
import { temReservaViva } from '../../core/pool/vagas.ts'
import { caminhos, Uso, type Ctx } from '../ctx.ts'
import { textosPara } from '../textos.ts'

/** Comando do JSON do hook: string, ou lista do Codex (`["bash","-lc","…"]` → o último; senão junta). */
export function comandoDe(entrada: unknown): string | null {
  const e = entrada as { tool_name?: string; tool_input?: Record<string, unknown>; command?: unknown; cmd?: unknown } | null
  if (e?.tool_name && !/^(?:functions\.)?(?:Bash|PowerShell|exec_command|shell|shell_command)$/i.test(e.tool_name)) return null
  const v = e?.tool_input?.command ?? e?.tool_input?.cmd ?? e?.command ?? e?.cmd
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
    return v.length >= 3 && /^-(l?c|command)$/i.test(v[1]) ? v[2] : v.join(' ')
  }
  return null
}

/** agent-pool hook <claude|codex>: lê o JSON do PreToolUse e responde no formato do agente. JSON ilegível libera. */
export async function hook(ctx: Ctx, args: string[]): Promise<number> {
  const t = textosPara(ctx.env)
  const agente = args[0]
  if (agente !== 'claude' && agente !== 'codex') throw new Uso(`${t.uso}: agent-pool hook <claude|codex>`)
  let comando: string | null = null
  let powershell = false
  try {
    const entrada = JSON.parse(await ctx.stdin())
    comando = comandoDe(entrada)
    const v = entrada?.tool_input?.command ?? entrada?.tool_input?.cmd ?? entrada?.command ?? entrada?.cmd
    powershell = /^PowerShell$/i.test(entrada?.tool_name ?? '') || (Array.isArray(v) && /^(?:powershell|pwsh)(?:\.exe)?$/i.test(String(v[0]).split(/[\\/]/).pop() ?? ''))
  } catch {}
  if (comando === null) return 0
  const p = caminhos(ctx)
  const d = decidir({ comando, agente, reservaViva: temReservaViva(p, ctx.agora()) })
  if (d.permitir) return 0
  // O lançador não está no PATH dos agentes: a sugestão usa o caminho absoluto.
  const lancador = join(p.bin, process.platform === 'win32' ? 'agent-pool.cmd' : 'agent-pool').replace(/\\/g, '/')
  const prefixo = powershell ? '& ' : ''
  const mensagem = d.motivo === 'reserva' ? t.hookSemReserva(lancador, prefixo) : t.hookNegado(lancador, d.trecho ?? comando, prefixo)
  if (agente === 'claude') {
    ctx.err(mensagem)
    return 2
  }
  // Codex trata exit 2 como falha e deixa passar: o veto é o JSON.
  ctx.out(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: mensagem } }))
  return 0
}
