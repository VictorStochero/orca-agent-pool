import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { ConfigFila } from '../tipos.ts'
import type { Executor } from './executores.ts'

const PORTAS: Record<string, number> = { mysql: 3306, postgres: 5432, mongodb: 27017, redis: 6379 }
const MOTORES: Record<string, string> = { pgsql: 'postgres', postgresql: 'postgres', mariadb: 'mysql' }
const CONTAINERS = new Set(['ddev', 'sail', 'docker', 'podman'])

function lerJson(arquivo: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(arquivo, 'utf8'))
  } catch {
    return null
  }
}

/** Valor de uma chave: ambiente, depois .env.testing, depois .env. */
export function valorEnv(dir: string, env: NodeJS.ProcessEnv, chave: string): string | undefined {
  if (env[chave]) return env[chave]
  for (const f of ['.env.testing', '.env']) {
    let texto: string
    try {
      texto = readFileSync(join(dir, f), 'utf8')
    } catch {
      continue
    }
    for (const linha of texto.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha)
      if (m?.[1] === chave) return m[2].replace(/^(["'])(.*)\1$/, '$2') || undefined
    }
  }
  return undefined
}

const normMotor = (m: string) => MOTORES[m] ?? m
const normHost = (h: string) => (['localhost', '::1', '[::1]', '0.0.0.0'].includes(h) ? '127.0.0.1' : h)

function formatar(motor: string, host: string, porta: string | number | undefined, banco?: string): string {
  const p = porta || PORTAS[motor]
  return `${motor} ${normHost(host)}${p ? `:${p}` : ''}${banco ? `/${banco}` : ''}`
}

function dePorUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const motor = normMotor(u.protocol.slice(0, -1).split('+')[0])
    return motor === 'sqlite' || !u.hostname ? null : formatar(motor, u.hostname, u.port, decodeURIComponent(u.pathname.slice(1)))
  } catch {
    return null
  }
}

/** Recurso disputado pelos testes: `<motor> <host>:<porta>[/<banco>]`, `container <executor>` ou `geral`. */
export function detectarRecurso(dir: string, env: NodeJS.ProcessEnv, executor: Executor | null): string {
  const manual = lerJson(join(dir, '.orca', 'agent-pool.json'))?.recurso
  if (typeof manual === 'string' && manual) return manual

  const url = valorEnv(dir, env, 'DATABASE_URL')
  const porUrl = url ? dePorUrl(url) : null
  if (porUrl) return porUrl

  const host = valorEnv(dir, env, 'DB_HOST')
  const porta = valorEnv(dir, env, 'DB_PORT')
  const conexao = valorEnv(dir, env, 'DB_CONNECTION')
  if ((host || porta || conexao) && conexao !== 'sqlite') return formatar(normMotor(conexao ?? 'mysql'), host ?? '127.0.0.1', porta, valorEnv(dir, env, 'DB_DATABASE'))

  const exe = executor ? basename(executor.comando[0]) : ''
  return CONTAINERS.has(exe) ? `container ${exe}` : 'geral'
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]/g, '_')

/** Nome da pasta da fila no state/fila. */
export function chaveFila(modo: ConfigFila['modo'], recurso: string, projeto: string): string {
  if (modo === 'global') return 'global'
  return modo === 'projeto' ? `proj-${slug(projeto)}` : slug(recurso)
}

/** Projeto = repositório principal (um worktree compartilha o nome com o repositório de origem). */
export function nomeProjeto(dir: string): string {
  try {
    const comum = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim()
    if (comum) return basename(dirname(comum))
  } catch {
    // fora de um repositório git
  }
  return basename(dir)
}
