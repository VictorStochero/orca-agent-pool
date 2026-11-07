import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { acharAgente } from '../core/catalogo.ts'
import { expandirHome, paths } from '../core/paths.ts'
import type { Config } from '../core/tipos.ts'
import { claude } from './claude.ts'
import { codex } from './codex.ts'
import { alvoReal, gravar } from './gravar.ts'

export type AgenteHook = 'claude' | 'codex'
export const AGENTES_HOOK: readonly AgenteHook[] = ['claude', 'codex']

/** Agentes que precisam de hook: os das contas da config. */
export function agentesComHook(c: Config): AgenteHook[] {
  const ids = new Set(c.pool.contas.map(ct => acharAgente(ct.agente)?.hook))
  return AGENTES_HOOK.filter(a => ids.has(a))
}

/** A config só com as contas ativas: o que Requisitos, Instalar e o doctor exigem; remover alcança todas. */
export const soAtivas = (c: Config): Config => ({ ...c, pool: { ...c.pool, contas: c.pool.contas.filter(ct => ct.ativo) } })

/**
 * Pastas de config das contas (ex.: `~/.claude-2`), por agente com hook; conta inativa entra para o Remove alcançar.
 * Só as que já existem: um erro de digitação em `config` não cria pasta nova.
 */
export function pastasDasContas(c: Config, home: string): Pastas {
  const pastas: Pastas = {}
  for (const ct of c.pool.contas) {
    const a = acharAgente(ct.agente)?.hook
    if (ct.config && a && existsSync(resolve(expandirHome(ct.config, home)))) {
      pastas[a] ??= []
      pastas[a].push(ct.config)
    }
  }
  return pastas
}

type Spec = {
  agente: string
  pasta: (home: string) => string
  arquivo: (dir: string) => string
  grupo: (lancador: string) => Record<string, unknown>
}
// biome-ignore lint/suspicious/noExplicitAny: JSON de configuração do agente, sem schema nosso
type Json = Record<string, any>

const SPECS: Record<AgenteHook, Spec> = { claude, codex }

/** Pasta de config que o agente usa quando a conta não define `config`. */
export const pastaPadrao = (a: AgenteHook, home: string): string => SPECS[a].pasta(home)

// Reconhece a nossa entrada pelo comando (`[& ]"<...>/agent-pool[.cmd]" hook <agente>`, o `& ` só no Codex do Windows), sem campo extra no JSON do agente.
const ehNosso = (h: Json, a: AgenteHook): boolean =>
  typeof h?.command === 'string' && new RegExp(`^(& )?"[^"]*agent-pool(\\.cmd)?" hook ${a}$`).test(h.command)
const temNosso = (g: unknown, a: AgenteHook): g is Json =>
  !!g && typeof g === 'object' && Array.isArray((g as Json).hooks) && (g as Json).hooks.some((h: Json) => ehNosso(h, a))
/** Tira só as nossas entradas do grupo; com as de terceiros ele continua, vazio ele sai. */
const semNosso = (g: Json, a: AgenteHook): Json[] => {
  const resto = g.hooks.filter((h: Json) => !ehNosso(h, a))
  return resto.length ? [{ ...g, hooks: resto }] : []
}

/**
 * O nosso grupo entra no lugar da primeira entrada nossa, no mesmo grupo e índice (o Codex guarda a confiança dos terceiros
 * pelo índice); sem nenhuma, vai ao fim. Entradas de terceiros dentro do grupo nosso ficam.
 */
function comNosso(grupos: unknown[], a: AgenteHook, novo: Json): unknown[] {
  let colocado = false
  const depois = grupos.flatMap((g): unknown[] => {
    if (!temNosso(g, a)) return [g]
    if (colocado) return semNosso(g, a)
    colocado = true
    if (g.hooks.every((h: Json) => ehNosso(h, a))) return [novo]
    return [{ ...g, hooks: g.hooks.map((h: Json) => (ehNosso(h, a) ? novo.hooks[0] : h)) }]
  })
  if (!colocado) depois.push(novo)
  return depois
}

type Lido = { texto: string | null; obj: Json } | { erro: string }

function ler(arquivo: string): Lido {
  if (!existsSync(arquivo)) return { texto: null, obj: {} }
  try {
    const texto = readFileSync(arquivo, 'utf8')
    const obj = texto.trim() === '' ? {} : JSON.parse(texto)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { erro: 'raiz_invalida' }
    if (obj.hooks !== undefined && (typeof obj.hooks !== 'object' || obj.hooks === null || Array.isArray(obj.hooks)))
      return { erro: 'hooks_invalido' }
    if (obj.hooks?.PreToolUse !== undefined && !Array.isArray(obj.hooks.PreToolUse)) return { erro: 'pretooluse_invalido' }
    return { texto, obj }
  } catch (e) {
    return { erro: (e as Error).message }
  }
}

/** Reserializa no estilo do original (indentação, fim de linha, newline final) para a remoção devolver o arquivo igual. */
function serializar(obj: Json, original: string | null): string {
  const indent = original?.match(/^([ \t]+)"/m)?.[1] ?? '  '
  const crlf = original?.includes('\r\n') ?? false
  let s = JSON.stringify(obj, null, indent)
  if (original === null || /\n$/.test(original)) s += '\n'
  return crlf ? s.replace(/\n/g, '\r\n') : s
}

/** Pastas de config extras por agente (ex.: `CLAUDE_CONFIG_DIR` de cada conta); `~` vale a casa. */
export type Pastas = Partial<Record<AgenteHook, string[]>>

type Alvo = { dir: string; arquivo: string; padrao: boolean }

/** Pasta padrão do agente mais as das contas, sem repetir: o mesmo arquivo real (link) conta uma vez. */
function alvosDe(home: string, a: AgenteHook, pastas: Pastas = {}, soPastas = false): Alvo[] {
  const spec = SPECS[a]
  const dirs = [...(soPastas ? [] : [spec.pasta(home)]), ...(pastas[a] ?? []).map(p => expandirHome(p, home))].map(d => resolve(d))
  const vistos = new Set<string>()
  const alvos: Alvo[] = []
  dirs.forEach((dir, i) => {
    const arquivo = spec.arquivo(dir)
    const real = alvoReal(arquivo)
    if (vistos.has(real)) return
    vistos.add(real)
    alvos.push({ dir, arquivo, padrao: i === 0 && !soPastas })
  })
  return alvos
}

/** Nome do backup: o do agente na pasta padrão; nas outras, com um sufixo da pasta. */
const nomeBackup = (base: string, alvo: Alvo) =>
  alvo.padrao ? base : `${base}-${createHash('sha1').update(alvo.dir).digest('hex').slice(0, 8)}`

const caminhoBackup = (home: string, nome: string, arquivo: string) => join(paths(home).backup, `${nome}-${basename(arquivo)}.orig`)

/** Cópia do original antes da primeira escrita; nunca sobrescreve a cópia já feita. A marca `.ausente` diz que o arquivo não existia. */
function backup(home: string, nome: string, arquivo: string): string | undefined {
  const alvo = caminhoBackup(home, nome, arquivo)
  if (existsSync(alvo)) return undefined
  mkdirSync(dirname(alvo), { recursive: true })
  if (existsSync(arquivo)) copyFileSync(arquivo, alvo)
  else {
    writeFileSync(`${alvo}.ausente`, '', { flag: 'wx' })
    writeFileSync(alvo, '', { flag: 'wx' })
  }
  return alvo
}

export type ResultadoInstalar = { agente: string; pasta: string; estado: 'instalado' | 'ja' | 'erro'; backup?: string; erro?: string }

export function instalarHooks(home: string, agentes: AgenteHook[], lancador: string, pastas?: Pastas): ResultadoInstalar[] {
  return agentes.flatMap(a =>
    alvosDe(home, a, pastas).map((alvo): ResultadoInstalar => {
      const spec = SPECS[a]
      const { arquivo, dir } = alvo
      try {
        const l = ler(arquivo)
        if ('erro' in l) return { agente: a, pasta: dir, estado: 'erro', erro: l.erro }
        const novo: Json = spec.grupo(lancador)
        const grupos: unknown[] = l.obj.hooks?.PreToolUse ?? []
        const bak = backup(home, nomeBackup(spec.agente, alvo), arquivo)
        const depois = comNosso(grupos, a, novo)
        let mudou = false
        if (JSON.stringify(depois) !== JSON.stringify(grupos)) {
          l.obj.hooks = { ...l.obj.hooks, PreToolUse: depois }
          gravar(arquivo, serializar(l.obj, l.texto))
          mudou = true
        }
        return { agente: a, pasta: dir, estado: mudou ? 'instalado' : 'ja', ...(bak ? { backup: bak } : {}) }
      } catch (e) {
        return { agente: a, pasta: dir, estado: 'erro', erro: (e as Error).message }
      }
    }),
  )
}

export type ResultadoRemover = { agente: string; pasta: string; estado: 'removido' | 'ausente' | 'erro'; erro?: string }

/** `soPastas`: tira só das pastas dadas, sem tocar na pasta padrão do agente (conta removida). */
export function removerHooks(home: string, agentes: AgenteHook[], pastas?: Pastas, soPastas = false): ResultadoRemover[] {
  return agentes.flatMap(a =>
    alvosDe(home, a, pastas, soPastas).map((alvo): ResultadoRemover => {
      const { arquivo, dir } = alvo
      try {
        const l = ler(arquivo)
        if ('erro' in l) return { agente: a, pasta: dir, estado: 'erro', erro: l.erro }
        const grupos: unknown[] = l.obj.hooks?.PreToolUse ?? []
        if (!grupos.some(g => temNosso(g, a))) return { agente: a, pasta: dir, estado: 'ausente' }
        const resto = grupos.flatMap((g): unknown[] => (temNosso(g, a) ? semNosso(g, a) : [g]))
        if (resto.length) l.obj.hooks.PreToolUse = resto
        else delete l.obj.hooks.PreToolUse
        if (Object.keys(l.obj.hooks).length === 0) delete l.obj.hooks
        const orig = caminhoBackup(home, nomeBackup(SPECS[a].agente, alvo), arquivo)
        // Arquivo que o próprio plugin criou e que ficou vazio sai inteiro; a marca e a cópia vazia saem junto.
        if (Object.keys(l.obj).length === 0 && existsSync(`${orig}.ausente`)) {
          for (const f of [arquivo, `${orig}.ausente`, orig]) rmSync(f, { force: true })
        } else gravar(arquivo, serializar(l.obj, l.texto))
        return { agente: a, pasta: dir, estado: 'removido' }
      } catch (e) {
        return { agente: a, pasta: dir, estado: 'erro', erro: (e as Error).message }
      }
    }),
  )
}

/** `desatualizado`: o nosso grupo no arquivo difere do esperado (outro timeout, outro lançador); Instalar troca o grupo. */
export type SituacaoHook = 'instalado' | 'ausente' | 'desatualizado' | 'erro'

export type EstadoHook = { agente: string; pasta: string; arquivo: string; estado: SituacaoHook; erro?: string }

/** Estado por pasta; `desatualizado` é calculado contra o grupo que o Instalar gravaria com este `lancador`. */
export function estadoHooks(home: string, lancador: string, pastas?: Pastas): EstadoHook[] {
  return AGENTES_HOOK.flatMap(a =>
    alvosDe(home, a, pastas).map((alvo): EstadoHook => {
      const l = ler(alvo.arquivo)
      if ('erro' in l) return { agente: a, pasta: alvo.dir, arquivo: alvo.arquivo, estado: 'erro', erro: l.erro }
      const grupos: unknown[] = l.obj.hooks?.PreToolUse ?? []
      const estado = !grupos.some(g => temNosso(g, a))
        ? 'ausente'
        : JSON.stringify(comNosso(grupos, a, SPECS[a].grupo(lancador))) === JSON.stringify(grupos)
          ? 'instalado'
          : 'desatualizado'
      return { agente: a, pasta: alvo.dir, arquivo: alvo.arquivo, estado }
    }),
  )
}
