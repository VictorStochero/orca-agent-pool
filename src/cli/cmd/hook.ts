import { decidir } from '../../core/hook/decisao.ts'
import { caminhoLancador } from '../../core/lancador.ts'
import { temReservaViva } from '../../core/pool/vagas.ts'
import { type Ctx, caminhos, Uso } from '../ctx.ts'
import { textosPara } from '../textos.ts'

type EntradaHook = { tool_name?: string; tool_input?: Record<string, unknown>; command?: unknown; cmd?: unknown } | null | undefined

const valorDoComando = (e: EntradaHook) => e?.tool_input?.command ?? e?.tool_input?.cmd ?? e?.command ?? e?.cmd

/** PowerShell pelo nome da ferramenta (Claude) ou pelo primeiro item da lista do comando (Codex). */
function ehPowerShell(e: EntradaHook): boolean {
  if (/^PowerShell$/i.test(e?.tool_name ?? '')) return true
  const v = valorDoComando(e)
  const programa = Array.isArray(v) ? String(v[0]).split(/[\\/]/).pop() : undefined
  return /^(?:powershell|pwsh)(?:\.exe)?$/i.test(programa ?? '')
}

/** Comando do JSON do hook: string, ou lista do Codex (`["bash","-lc","…"]` → o último; senão junta). */
export function comandoDe(entrada: unknown): string | null {
  const e = entrada as EntradaHook
  if (e?.tool_name && !/^(?:functions\.)?(?:Bash|PowerShell|exec_command|shell|shell_command)$/i.test(e.tool_name)) return null
  const v = valorDoComando(e)
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.every(x => typeof x === 'string')) {
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
    const entrada: EntradaHook = JSON.parse(await ctx.stdin())
    comando = comandoDe(entrada)
    powershell = ehPowerShell(entrada)
  } catch {}
  if (comando === null) return 0
  const p = caminhos(ctx)
  const d = decidir({ comando, reservaViva: temReservaViva(p, ctx.agora()) })
  if (d.permitir) return 0
  // O lançador não está no PATH dos agentes: a sugestão usa o caminho absoluto.
  const lancador = caminhoLancador(p.bin).replace(/\\/g, '/')
  // O Codex no Windows roda os comandos pelo PowerShell, mesmo quando a entrada não deixa ver.
  const prefixo = powershell || (agente === 'codex' && process.platform === 'win32') ? '& ' : ''
  const mensagem = d.motivo === 'reserva' ? t.hookSemReserva(lancador, prefixo) : t.hookNegado(lancador, d.trecho ?? comando, prefixo)
  if (agente === 'claude') {
    ctx.err(mensagem)
    return 2
  }
  // Codex trata exit 2 como falha e deixa passar: o veto é o JSON.
  ctx.out(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: mensagem } }),
  )
  return 0
}
