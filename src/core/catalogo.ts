import { nomeDoExecutavel, semAtribuicoes } from './executavel.ts'
import { PAPEIS, type Papel } from './tipos.ts'

export type Agente = {
  id: string
  idOrca: string | null
  comandos: string[]
  familia: 'claude' | 'gpt' | 'gemini' | 'outro'
  medidor: 'claude' | 'orca' | null
  hook: 'claude' | 'codex' | null
  papeisPadrao: Papel[]
  provado: boolean
  /** Modelo usado quando a conta não define um. */
  modeloPadrao?: string
  perfilGerenciadoDe?: string
}

export const PAPEIS_TRABALHO: readonly Papel[] = PAPEIS.filter(p => p !== 'orquestra' && p !== 'segunda-opiniao')

const TRABALHO: Papel[] = [...PAPEIS_TRABALHO]

// provado = despacho por worker confirmado (claude, codex, antigravity).
export const CATALOGO: readonly Agente[] = [
  {
    id: 'claude',
    idOrca: 'claude',
    comandos: ['claude'],
    familia: 'claude',
    medidor: 'claude',
    hook: 'claude',
    papeisPadrao: TRABALHO,
    provado: true,
  },
  {
    id: 'codex',
    idOrca: 'codex',
    comandos: ['codex'],
    familia: 'gpt',
    medidor: 'orca',
    hook: 'codex',
    papeisPadrao: TRABALHO,
    provado: true,
  },
  {
    id: 'antigravity',
    idOrca: 'antigravity',
    comandos: ['agy'],
    familia: 'gemini',
    medidor: 'orca',
    hook: null,
    papeisPadrao: TRABALHO,
    provado: true,
    modeloPadrao: 'gemini-3.8-flash-high',
  },
  {
    id: 'opencode',
    idOrca: 'opencode',
    comandos: ['opencode'],
    familia: 'outro',
    medidor: null,
    hook: null,
    papeisPadrao: [],
    provado: false,
  },
  {
    id: 'opencode2',
    idOrca: 'opencode2',
    comandos: ['opencode'],
    familia: 'outro',
    medidor: null,
    hook: null,
    papeisPadrao: [],
    provado: false,
    perfilGerenciadoDe: 'opencode',
  },
  { id: 'gemini', idOrca: null, comandos: ['gemini'], familia: 'gemini', medidor: 'orca', hook: null, papeisPadrao: [], provado: false },
  { id: 'kimi', idOrca: 'kimi', comandos: ['kimi'], familia: 'outro', medidor: 'orca', hook: null, papeisPadrao: [], provado: false },
]

export function acharAgente(id: string): Agente | null {
  return CATALOGO.find(a => a.id === id) ?? null
}

/** Programa do comando como escrito (sem `VAR=valor` à frente nem aspas): `"C:\Program Files\x.exe" -a` → `C:\Program Files\x.exe`. */
export function programaDe(comando: string): string | null {
  const tok = semAtribuicoes(comando.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) ?? [])[0]
  return tok ? tok.replace(/["']/g, '') : null
}

/** Executável do comando sem `VAR=valor` à frente nem extensão (`C:\bin\codex.exe` → `codex`). */
export function executavelDe(comando: string): string | null {
  const [programa] = semAtribuicoes(comando.trim().split(/\s+/))
  return programa === undefined ? null : nomeDoExecutavel(programa)
}

/** Agente pelo executável do comando; só o diretório de config (sem comando) = claude. Perfil gerenciado só por id. */
export function deduzirAgente(comando: string | null, configDir: string | null): Agente | null {
  const exe = comando ? executavelDe(comando) : null
  if (exe) {
    const porNome = (nome: string) => CATALOGO.find(a => !a.perfilGerenciadoDe && (a.id === nome || a.comandos.includes(nome)))
    // claude-work, claude_work: o agente é o prefixo
    return porNome(exe) ?? porNome(exe.split(/[-_.]/)[0]) ?? null
  }
  return configDir ? acharAgente('claude') : null
}
