import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

const chaveEnv = (env: NodeJS.ProcessEnv, nome: string) => Object.keys(env).find((k) => k.toLowerCase() === nome) ?? nome

/** No Windows, npm/pnpm/yarn são .cmd e o Node recusa spawn direto: resolve pelo PATH e passa pelo cmd.exe. */
export function lancar(comando: string[], cwd: string | undefined, env: NodeJS.ProcessEnv, stdio: StdioOptions = 'inherit'): ChildProcess {
  const [exe, ...args] = comando
  const opcoes = { cwd, env, stdio, windowsHide: true }
  if (process.platform === 'win32') {
    const dirs = isAbsolute(exe) ? [''] : (env[chaveEnv(env, 'path')] ?? '').split(delimiter)
    for (const d of dirs) {
      const achado = ['.exe', '.cmd', '.bat', '.com'].map((x) => join(d, exe + x)).find(existsSync) ?? (existsSync(exe) ? exe : undefined)
      if (!achado) continue
      if (!/\.(cmd|bat)$/i.test(achado)) return spawn(achado, args, opcoes)
      const q = (a: string) => (/[\s"&|<>^%()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)
      const linha = [`"${achado}"`, ...args.map(q)].join(' ')
      return spawn(env[chaveEnv(env, 'comspec')] ?? 'cmd.exe', ['/d', '/s', '/c', `"${linha}"`], { ...opcoes, windowsVerbatimArguments: true })
    }
  }
  return spawn(exe, args, opcoes)
}
