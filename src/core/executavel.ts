import { type ChildProcess, type StdioOptions, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'

/** Nome da variável como o `env` a escreve (no Windows `Path` e `PATH` são a mesma); ausente, o próprio `nome`. */
export const chaveEnv = (env: NodeJS.ProcessEnv, nome: string) => Object.keys(env).find(k => k.toLowerCase() === nome.toLowerCase()) ?? nome

/** Nome do programa sem pasta nem extensão, em minúsculas (`C:\bin\Codex.exe` → `codex`). */
export const nomeDoExecutavel = (caminho: string) =>
  caminho
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|cmd|bat)$/, '')

/** Palavras do comando sem as atribuições `VAR=valor` à frente. */
export function semAtribuicoes(palavras: string[]): string[] {
  const i = palavras.findIndex(p => !/^[A-Za-z_]\w*=/.test(p))
  return i < 0 ? [] : palavras.slice(i)
}

/** Palavras do comando separadas em atribuições `VAR=valor` (corta no primeiro `=`) e o resto; só atribuições = resto vazio. */
export function separarAtribuicoes(palavras: string[]): { vars: [string, string][]; resto: string[] } {
  const resto = semAtribuicoes(palavras)
  const vars = palavras.slice(0, palavras.length - resto.length).map((a): [string, string] => {
    const i = a.indexOf('=')
    return [a.slice(0, i), a.slice(i + 1)]
  })
  return { vars, resto }
}

const EXTENSOES_WINDOWS = ['.exe', '.cmd', '.bat', '.com']

/** Arquivo executável de `exe` no Windows: nome com pasta busca só a partir do `cwd`; nome simples, no PATH. */
function acharNoWindows(exe: string, cwd: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  const nomes = EXTENSOES_WINDOWS.map(x => exe + x)
  // O nome exato só vale com extensão executável: `vendor/bin/pest` é script PHP, quem roda é o `pest.bat` ao lado.
  if (/\.(exe|cmd|bat|com)$/i.test(exe)) nomes.push(exe)
  const dirs = /[\\/]/.test(exe) ? [cwd ?? process.cwd()] : (env[chaveEnv(env, 'PATH')] ?? '').split(delimiter)
  return dirs.flatMap(d => nomes.map(n => resolve(d, n))).find(existsSync)
}

/** No Windows, npm/pnpm/yarn são .cmd e o Node recusa spawn direto: resolve pelo PATH e passa pelo cmd.exe. */
export function lancar(comando: string[], cwd: string | undefined, env: NodeJS.ProcessEnv, stdio: StdioOptions = 'inherit'): ChildProcess {
  const [exe, ...args] = comando
  const opcoes = { cwd, env, stdio, windowsHide: true }
  const achado = process.platform === 'win32' ? acharNoWindows(exe, cwd, env) : undefined
  if (!achado) return spawn(exe, args, opcoes)
  if (!/\.(cmd|bat)$/i.test(achado)) return spawn(achado, args, opcoes)
  const q = (a: string) => (/[\s"&|<>^%()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)
  const linha = [`"${achado}"`, ...args.map(q)].join(' ')
  return spawn(env[chaveEnv(env, 'ComSpec')] ?? 'cmd.exe', ['/d', '/s', '/c', `"${linha}"`], { ...opcoes, windowsVerbatimArguments: true })
}
