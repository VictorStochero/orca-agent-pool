import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { after } from 'node:test'

export function envCasa(home: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, HOME: home, USERPROFILE: home }
  delete env.HOMEDRIVE
  delete env.HOMEPATH
  return env
}

/** Detecta criação e alteração sem seguir links nem registrar conteúdo do usuário. */
export function retratoCasa(home: string): Record<string, string> {
  const arquivos: Record<string, string> = {}
  const visitar = (arquivo: string): void => {
    if (!existsSync(arquivo)) return
    const s = lstatSync(arquivo)
    const k = relative(home, arquivo)
    // O agent-pool instalado de verdade grava medidas, vagas e fila em state/ enquanto a suíte roda.
    if (k === join('.agents', 'agent-pool', 'state')) return
    if (s.isSymbolicLink()) arquivos[k] = `link:${readlinkSync(arquivo)}`
    else if (s.isDirectory()) {
      arquivos[k] = 'pasta'
      for (const f of readdirSync(arquivo).sort()) visitar(join(arquivo, f))
    } else arquivos[k] = createHash('sha256').update(readFileSync(arquivo)).digest('hex')
  }
  for (const p of ['.agents', '.claude/skills', '.codex/skills', '.claude/settings.json', '.codex/hooks.json', '.codex/config.toml'])
    visitar(join(home, p))
  return arquivos
}

export function guardarCasaReal(): void {
  const real = homedir()
  const antes = retratoCasa(real)
  after(() => assert.deepEqual(retratoCasa(real), antes, 'a suíte alterou a casa real do usuário'))
}
