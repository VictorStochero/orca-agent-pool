import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lancar } from '../executavel.ts'
import { lerCaminhoDoSistema } from '../orca.ts'
import type { Conta, Medida } from '../tipos.ts'

export type DependenciasMedida = {
  home: string
  fetch: typeof fetch
  /** ms desde a época, como todo o núcleo. */
  agora: number
  executarUsage?: (dir: string) => Promise<string>
  executarStatus?: (dir: string) => Promise<string>
}

/** Roda o `claude` da conta (com .cmd e o PATH do sistema no Windows, que o worker não herda) e devolve o stdout, ou '' em qualquer falha. */
export async function claude(dir: string, args: string[], bin = 'claude'): Promise<string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ORCA_')))
  env.CLAUDE_CONFIG_DIR = dir
  if (process.platform === 'win32') {
    const chave = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
    env[chave] = [env[chave], await lerCaminhoDoSistema()].filter(Boolean).join(';')
  }
  return new Promise(resolve => {
    let texto = ''
    const filho = lancar([bin, ...args], undefined, env, ['ignore', 'pipe', 'ignore'])
    // No Windows o kill() de um claude.cmd não encerra o neto que segura o stdout: resolve já, o close tardio não faz nada.
    const desistir = () => { filho.kill(); resolve('') }
    // `claude -p /usage` leva 11-14 s pelo claude.cmd no Windows, mais com a máquina ocupada ou renovando o token.
    const prazo = setTimeout(desistir, 45000)
    filho.stdout?.on('data', dados => {
      texto += dados.toString()
      if (texto.length > 65536) { clearTimeout(prazo); desistir() }
    })
    filho.on('error', () => { clearTimeout(prazo); resolve('') })
    // Deslogada sai com código 1 e imprime a prova: o chamador só aceita o que reconhece.
    filho.on('close', () => { clearTimeout(prazo); resolve(texto) })
  })
}

const usage = (dir: string) => claude(dir, ['--strict-mcp-config', '-p', '/usage'])
const status = (dir: string) => claude(dir, ['auth', 'status'])

/** Pasta de configuração da conta Claude; `~` é a casa. */
export function pastaDaConta(conta: Conta, home: string): string {
  const config = conta.config ?? '~/.claude'
  return config === '~' ? home : /^~[/\\]/.test(config) ? join(home, config.slice(2)) : config
}

export async function medirClaude(conta: Conta, d: DependenciasMedida): Promise<Medida> {
  const dir = pastaDaConta(conta, d.home)
  const base: Medida = { conta: conta.nome, curta: null, longa: null, resetLongaTs: null, estado: 'sem_login', medidaTs: d.agora }
  const semLogin = (): Medida => ({ ...base, acao: `CLAUDE_CONFIG_DIR=${/\s/.test(dir) ? JSON.stringify(dir) : dir} claude auth login` })
  const lerToken = (): string | null => {
    try {
      const cred = JSON.parse(readFileSync(join(dir, '.credentials.json'), 'utf8')).claudeAiOauth
      if (typeof cred?.accessToken === 'string' && cred.accessToken && typeof cred.expiresAt === 'number' && cred.expiresAt > d.agora) return cred.accessToken
    } catch { /* Sem arquivo (ex.: Keychain no macOS) ou token vencido: só o próprio `claude` renova e sabe. */ }
    return null
  }
  const porApi = async (token: string): Promise<Medida | null> => {
    try {
      const resposta = await d.fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (resposta.ok) {
        const json = await resposta.json() as { five_hour?: { utilization?: number }; seven_day?: { utilization?: number; resets_at?: string }; limits?: { kind?: string; percent?: number; scope?: { model?: { display_name?: string } | null } | null }[] }
        const pct = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null
        const curta = pct(json.five_hour?.utilization)
        const longa = pct(json.seven_day?.utilization)
        if (curta !== null || longa !== null) {
          const reset = Date.parse(json.seven_day?.resets_at ?? '')
          const limites = (Array.isArray(json.limits) ? json.limits : []).flatMap((l) => {
            const nome = l?.kind === 'weekly_scoped' ? l.scope?.model?.display_name : null
            return typeof nome === 'string' && nome ? [{ nome, curta: null, longa: pct(l.percent) }] : []
          })
          return { ...base, curta, longa, resetLongaTs: Number.isFinite(reset) ? reset : null, estado: 'ok', ...(limites.length ? { limites } : {}) }
        }
      }
    } catch { /* Cai no /usage; falhas externas não podem expor credenciais. */ }
    return null
  }

  const token = lerToken()
  const daApi = token ? await porApi(token) : null
  if (daApi) return daApi

  try {
    const texto = await (d.executarUsage ?? usage)(dir)
    if (/not (?:logged|signed) in|please (?:run \/login|log in)|authentication required/i.test(texto)) return semLogin()
    const curta = texto.match(/^Current session:\s*(\d+(?:\.\d+)?)%/m)
    const longa = texto.match(/^Current week \(all models\):\s*(\d+(?:\.\d+)?)%/m)
    if (longa && Number(longa[1]) <= 100 && (!curta || Number(curta[1]) <= 100)) {
      const limites = [...texto.matchAll(/^Current week \((?!all models\))([^)]+)\):\s*(\d+(?:\.\d+)?)%/gm)]
        .filter((m) => Number(m[2]) <= 100)
        .map((m) => ({ nome: m[1].trim(), curta: null, longa: Math.round(Number(m[2])) }))
      return { ...base, curta: curta ? Math.round(Number(curta[1])) : null, longa: Math.round(Number(longa[1])), estado: 'ok', ...(limites.length ? { limites } : {}) }
    }
    // O claude renova o token vencido logo na partida, mesmo quando o /usage não responde a tempo.
    const novo = lerToken()
    const renovada = novo && novo !== token ? await porApi(novo) : null
    if (renovada) return renovada
    // Sem prova de deslogada: "sem login" só quando o próprio claude disser.
    if (JSON.parse(await (d.executarStatus ?? status)(dir)).loggedIn === false) return semLogin()
  } catch { /* Falhas externas não podem expor credenciais. */ }
  return { ...base, estado: 'erro', erro: 'claude_usage_unavailable' }
}
