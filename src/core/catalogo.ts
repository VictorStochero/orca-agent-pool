import type { Papel } from './tipos.ts'

export type Agente = {
  id: string
  idOrca: string | null
  comandos: string[]
  familia: 'claude' | 'gpt' | 'gemini' | 'outro'
  medidor: 'claude' | 'orca' | null
  hook: 'claude' | 'codex' | null
  papeisPadrao: Papel[]
  provado: boolean
  perfilGerenciadoDe?: string
}

export const PAPEIS_TRABALHO: readonly Papel[] = ['escritor', 'revisor', 'verificador', 'mecanico']

const TRABALHO: Papel[] = [...PAPEIS_TRABALHO]

// provado = despacho por worker confirmado (claude, codex, antigravity).
export const CATALOGO: readonly Agente[] = [
  { id: 'claude', idOrca: 'claude', comandos: ['claude'], familia: 'claude', medidor: 'claude', hook: 'claude', papeisPadrao: TRABALHO, provado: true },
  { id: 'codex', idOrca: 'codex', comandos: ['codex'], familia: 'gpt', medidor: 'orca', hook: 'codex', papeisPadrao: TRABALHO, provado: true },
  { id: 'antigravity', idOrca: 'antigravity', comandos: ['agy'], familia: 'gemini', medidor: 'orca', hook: null, papeisPadrao: TRABALHO, provado: true },
  { id: 'opencode', idOrca: 'opencode', comandos: ['opencode'], familia: 'outro', medidor: null, hook: null, papeisPadrao: [], provado: false },
  { id: 'opencode2', idOrca: 'opencode2', comandos: ['opencode'], familia: 'outro', medidor: null, hook: null, papeisPadrao: [], provado: false, perfilGerenciadoDe: 'opencode' },
  { id: 'gemini', idOrca: null, comandos: ['gemini'], familia: 'gemini', medidor: 'orca', hook: null, papeisPadrao: [], provado: false },
  { id: 'kimi', idOrca: 'kimi', comandos: ['kimi'], familia: 'outro', medidor: 'orca', hook: null, papeisPadrao: [], provado: false }
]

export function acharAgente(id: string): Agente | null {
  return CATALOGO.find((a) => a.id === id) ?? null
}

/** Executável do comando sem `VAR=valor` à frente nem extensão (`C:\bin\codex.exe` → `codex`). */
export function executavelDe(comando: string): string | null {
  const toks = comando.trim().split(/\s+/)
  while (toks.length && /^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(toks[0])) toks.shift()
  if (!toks.length) return null
  const base = toks[0].replace(/\\/g, '/').split('/').pop()!.toLowerCase()
  return base.replace(/\.(exe|cmd|bat)$/, '')
}

/** Agente pelo executável do comando; só o diretório de config (sem comando) = claude. Perfil gerenciado só por id. */
export function deduzirAgente(comando: string | null, configDir: string | null): Agente | null {
  const exe = comando ? executavelDe(comando) : null
  if (exe) {
    const porNome = (nome: string) => CATALOGO.find((a) => !a.perfilGerenciadoDe && (a.id === nome || a.comandos.includes(nome)))
    // claude-work, claude_work: o agente é o prefixo
    return porNome(exe) ?? porNome(exe.split(/[-_.]/)[0]) ?? null
  }
  return configDir ? acharAgente('claude') : null
}
