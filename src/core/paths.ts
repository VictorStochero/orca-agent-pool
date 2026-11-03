import { homedir } from 'node:os'
import { join } from 'node:path'

export type Paths = {
  /** Casa do usuário: resolve o `~` das pastas de conta. */
  home: string
  raiz: string
  config: string
  state: string
  fila: string
  espera: string
  vagas: string
  medidas: string
  backup: string
  bin: string
}

/** Dados do agent-pool em ~/.agents/agent-pool; o lançador em ~/.agents/bin. */
export function paths(home: string = homedir()): Paths {
  const raiz = join(home, '.agents', 'agent-pool')
  const state = join(raiz, 'state')
  return {
    home,
    raiz,
    config: join(raiz, 'config.json'),
    state,
    fila: join(state, 'fila'),
    espera: join(state, 'espera'),
    vagas: join(state, 'vagas'),
    medidas: join(state, 'medidas'),
    backup: join(state, 'backup'),
    bin: join(home, '.agents', 'bin')
  }
}

/** Cópia da skill lida pelos agentes: ~/.agents/skills/agent-pool. */
export function destinoSkill(home: string = homedir()): string {
  return join(home, '.agents', 'skills', 'agent-pool')
}
