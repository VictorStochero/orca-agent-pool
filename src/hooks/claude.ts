import { join } from 'node:path'

export const claude = {
  agente: 'claude',
  pasta: (home: string) => join(home, '.claude'),
  arquivo: (dir: string) => join(dir, 'settings.json'),
  grupo: (lancador: string) => ({
    matcher: 'Bash|PowerShell',
    hooks: [{ type: 'command', command: `"${lancador}" hook claude` }],
  }),
}
