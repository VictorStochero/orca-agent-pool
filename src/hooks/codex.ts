import { join } from 'node:path'

// Codex: grupo sem matcher em PreToolUse. O config.toml não é tocado: o próprio Codex pede ao usuário para confiar no hook.
// No Windows o Codex roda o comando pelo PowerShell, que só executa caminho entre aspas com o prefixo `&`.
// O timeout muda o hash do grupo: a confiança que a 1.0.10 gravou no config.toml deixa de valer e o Codex pergunta de novo.
export const codex = {
  agente: 'codex',
  pasta: (home: string) => join(home, '.codex'),
  arquivo: (dir: string) => join(dir, 'hooks.json'),
  grupo: (lancador: string) => ({
    hooks: [{ type: 'command', command: `${process.platform === 'win32' ? '& ' : ''}"${lancador}" hook codex`, timeout: 15 }],
  }),
}
