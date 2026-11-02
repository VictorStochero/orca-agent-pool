import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { valorEnv as valor } from './recurso.ts'

type Conexao = { conexao?: string; host?: string; porta?: string; usuario?: string; senha?: string; base?: string }

/** Conexão do ambiente de teste Laravel: ambiente, depois .env.testing, depois .env. */
export function lerConexao(dir: string, env: NodeJS.ProcessEnv): Conexao {
  const v = (k: string) => valor(dir, env, k)
  return { conexao: v('DB_CONNECTION'), host: v('DB_HOST'), porta: v('DB_PORT'), usuario: v('DB_USERNAME'), senha: v('DB_PASSWORD'), base: v('DB_DATABASE') }
}

/** DROP dos `<base>_test_1..N` que o `--parallel` do Laravel cria; null se o nome do banco for suspeito. */
export function sqlLimpeza(base: string, n: number): string | null {
  if (!/^\w+$/.test(base)) return null
  return Array.from({ length: n }, (_, i) => `DROP DATABASE IF EXISTS \`${base}_test_${i + 1}\`;`).join(' ')
}

function dirsDeCliente(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? env.USERPROFILE ?? homedir()
  const sub = (pai: string) => {
    try {
      return readdirSync(pai).map((d) => join(pai, d, 'bin'))
    } catch {
      return []
    }
  }
  const path = env.PATH ?? env.Path ?? ''
  return [
    ...path.split(delimiter),
    ...sub(join(home, '.config', 'herd', 'bin', 'services', 'mariadb')),
    ...sub(join(home, '.config', 'herd', 'bin', 'services', 'mysql')),
    ...sub('C:/laragon/bin/mysql')
  ]
}

function acharCliente(env: NodeJS.ProcessEnv): string | null {
  for (const d of dirsDeCliente(env)) {
    for (const nome of ['mariadb', 'mysql']) {
      const achado = [nome, `${nome}.exe`].map((f) => join(d, f)).find((f) => d && existsSync(f))
      if (achado) return achado
    }
  }
  return null
}

/** Depois de um `php artisan test --parallel`, apaga os bancos `<banco>_test_N` do MySQL/MariaDB do host. Silencioso se não houver cliente. */
export async function limparBancosLaravel(dir: string, env: NodeJS.ProcessEnv, n: number): Promise<void> {
  const c = lerConexao(dir, env)
  if (c.conexao !== 'mysql' && c.conexao !== 'mariadb') return
  const sql = c.base ? sqlLimpeza(c.base, n) : null
  const cliente = acharCliente(env)
  if (!sql || !cliente) return
  await new Promise<void>((resolve) => {
    const proc = spawn(cliente, [`-u${c.usuario ?? 'root'}`, `-h${c.host ?? '127.0.0.1'}`, `-P${c.porta ?? '3306'}`, '-e', sql], {
      env: { ...env, MYSQL_PWD: c.senha ?? '' },
      stdio: 'ignore'
    })
    proc.on('error', () => resolve())
    proc.on('close', () => resolve())
  })
}
