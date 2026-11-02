import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { acharAgente } from '../core/catalogo.ts'
import { paths } from '../core/paths.ts'
import type { Config } from '../core/tipos.ts'
import { claude } from './claude.ts'
import { codex, confiar, desconfiar, renomearConfianca } from './codex.ts'
import { alvoReal, gravar } from './gravar.ts'

export type AgenteHook = 'claude' | 'codex'
export const AGENTES_HOOK: readonly AgenteHook[] = ['claude', 'codex']

/** Agentes que precisam de hook: os das contas da config. */
export function agentesComHook(c: Config): AgenteHook[] {
  const ids = new Set(c.pool.contas.map((ct) => acharAgente(ct.agente)?.hook))
  return AGENTES_HOOK.filter((a) => ids.has(a))
}

/** Pastas de config das contas (ex.: `~/.claude-2`), por agente com hook; conta inativa entra para o Remove alcançar. */
export function pastasDasContas(c: Config): Pastas {
  const pastas: Pastas = {}
  for (const ct of c.pool.contas) {
    const a = acharAgente(ct.agente)?.hook
    if (ct.config && a) (pastas[a] ??= []).push(ct.config)
  }
  return pastas
}

type Spec = { agente: string; pasta: (home: string) => string; arquivo: (dir: string) => string; grupo: (lancador: string) => Record<string, unknown> }
type Json = Record<string, any>

const SPECS: Record<AgenteHook, Spec> = { claude, codex }
// Reconhece o nosso hook pelo comando (`"<...>/agent-pool[.cmd]" hook <agente>`), sem campo extra no JSON do agente.
const nosso = (g: unknown, a: AgenteHook): boolean =>
  !!g && typeof g === 'object' && Array.isArray((g as Json).hooks) &&
  (g as Json).hooks.some((h: Json) => typeof h?.command === 'string' && new RegExp(`^"[^"]*agent-pool(\\.cmd)?" hook ${a}$`).test(h.command))

type Lido = { texto: string | null; obj: Json } | { erro: string }

function ler(arquivo: string): Lido {
  if (!existsSync(arquivo)) return { texto: null, obj: {} }
  const texto = readFileSync(arquivo, 'utf8')
  try {
    const obj = texto.trim() === '' ? {} : JSON.parse(texto)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { erro: 'raiz_invalida' }
    if (obj.hooks !== undefined && (typeof obj.hooks !== 'object' || obj.hooks === null || Array.isArray(obj.hooks))) return { erro: 'hooks_invalido' }
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
  const dirs = [...(soPastas ? [] : [spec.pasta(home)]), ...(pastas[a] ?? []).map((p) => (p.startsWith('~') ? join(home, p.slice(1)) : p))].map((d) => resolve(d))
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
const nomeBackup = (base: string, alvo: Alvo) => (alvo.padrao ? base : `${base}-${createHash('sha1').update(alvo.dir).digest('hex').slice(0, 8)}`)

/** Cópia do original antes da primeira escrita; nunca sobrescreve a cópia já feita. */
function backup(home: string, nome: string, arquivo: string): string | undefined {
  const dir = paths(home).backup
  const alvo = join(dir, `${nome}-${basename(arquivo)}.orig`)
  if (existsSync(alvo)) return undefined
  mkdirSync(dir, { recursive: true })
  if (existsSync(arquivo)) copyFileSync(arquivo, alvo)
  else {
    writeFileSync(alvo + '.ausente', '', { flag: 'wx' })
    writeFileSync(alvo, '', { flag: 'wx' })
  }
  return alvo
}

export type ResultadoInstalar = { agente: string; pasta: string; estado: 'instalado' | 'ja' | 'erro'; backup?: string; erro?: string }

/** Codex: a confiança é por índice; grupos de terceiros que mudaram de posição levam a chave junto (sempre para baixo, então em ordem crescente não colide). */
function acompanharIndices(dir: string, arquivo: string, antes: unknown[], depois: unknown[]): void {
  depois.forEach((g, para) => {
    const de = antes.indexOf(g)
    if (de > para) renomearConfianca(dir, arquivo, de, para)
  })
}

const comandoDe =(g: Json): { comando: string; timeout: number } => ({ comando: g.hooks[0].command, timeout: g.hooks[0].timeout ?? 10 })

export function instalarHooks(home: string, agentes: AgenteHook[], lancador: string, pastas?: Pastas): ResultadoInstalar[] {
  return agentes.flatMap((a) => alvosDe(home, a, pastas).map((alvo): ResultadoInstalar => {
    const spec = SPECS[a]
    const { arquivo, dir } = alvo
    try {
      const l = ler(arquivo)
      if ('erro' in l) return { agente: a, pasta: dir, estado: 'erro', erro: l.erro }
      const novo = spec.grupo(lancador)
      const grupos: unknown[] = l.obj.hooks?.PreToolUse ?? []
      const velhos = grupos.filter((g) => nosso(g, a))
      let mudou = false
      const bak = backup(home, nomeBackup(spec.agente, alvo), arquivo)
      if (!(velhos.length === 1 && JSON.stringify(velhos[0]) === JSON.stringify(novo))) {
        if (a === 'codex' && velhos.length) backup(home, nomeBackup('codex-config', alvo), join(dir, 'config.toml'))
        if (a === 'codex') velhos.forEach((g) => desconfiar(dir, arquivo, grupos.indexOf(g)))
        // Entra no lugar do primeiro grupo nosso (sem mexer nos índices de terceiros); sem nenhum, vai ao fim.
        const pos = grupos.findIndex((g) => nosso(g, a))
        const depois = pos < 0 ? [...grupos, novo] : grupos.flatMap((g, i) => (i === pos ? [novo] : nosso(g, a) ? [] : [g]))
        if (a === 'codex') acompanharIndices(dir, arquivo, grupos, depois)
        l.obj.hooks = { ...l.obj.hooks, PreToolUse: depois }
        gravar(arquivo, serializar(l.obj, l.texto))
        mudou = true
      }
      if (a === 'codex') {
        const n = (l.obj.hooks.PreToolUse as unknown[]).findIndex((g) => nosso(g, a))
        const { comando, timeout } = comandoDe(novo)
        const antes = (arq: string) => { backup(home, nomeBackup('codex-config', alvo), arq) }
        if (confiar(dir, arquivo, n, comando, timeout, antes)) mudou = true
      }
      return { agente: a, pasta: dir, estado: mudou ? 'instalado' : 'ja', ...(bak ? { backup: bak } : {}) }
    } catch (e) {
      return { agente: a, pasta: dir, estado: 'erro', erro: (e as Error).message }
    }
  }))
}

export type ResultadoRemover = { agente: string; pasta: string; estado: 'removido' | 'ausente' | 'erro'; erro?: string }

/** `soPastas`: tira só das pastas dadas, sem tocar na pasta padrão do agente (conta removida). */
export function removerHooks(home: string, agentes: AgenteHook[], pastas?: Pastas, soPastas = false): ResultadoRemover[] {
  return agentes.flatMap((a) => alvosDe(home, a, pastas, soPastas).map((alvo): ResultadoRemover => {
    const { arquivo, dir } = alvo
    try {
      const l = ler(arquivo)
      if ('erro' in l) return { agente: a, pasta: dir, estado: 'erro', erro: l.erro }
      const grupos: unknown[] = l.obj.hooks?.PreToolUse ?? []
      const velhos = grupos.filter((g) => nosso(g, a))
      if (!velhos.length) return { agente: a, pasta: dir, estado: 'ausente' }
      if (a === 'codex') velhos.forEach((g) => desconfiar(dir, arquivo, grupos.indexOf(g)))
      const resto = grupos.filter((g) => !nosso(g, a))
      if (a === 'codex') acompanharIndices(dir, arquivo, grupos, resto)
      if (resto.length) l.obj.hooks.PreToolUse = resto
      else delete l.obj.hooks.PreToolUse
      if (Object.keys(l.obj.hooks).length === 0) delete l.obj.hooks
      gravar(arquivo, serializar(l.obj, l.texto))
      return { agente: a, pasta: dir, estado: 'removido' }
    } catch (e) {
      return { agente: a, pasta: dir, estado: 'erro', erro: (e as Error).message }
    }
  }))
}

export type EstadoHook = { agente: string; pasta: string; estado: 'instalado' | 'ausente' | 'erro'; erro?: string }

export function estadoHooks(home: string, pastas?: Pastas): EstadoHook[] {
  return AGENTES_HOOK.flatMap((a) => alvosDe(home, a, pastas).map((alvo): EstadoHook => {
    const l = ler(alvo.arquivo)
    if ('erro' in l) return { agente: a, pasta: alvo.dir, estado: 'erro', erro: l.erro }
    return { agente: a, pasta: alvo.dir, estado: (l.obj.hooks?.PreToolUse ?? []).some((g: unknown) => nosso(g, a)) ? 'instalado' : 'ausente' }
  }))
}
