// Regra da skill sem escrita em disco: a cópia presa à versão e os links por agente e conta. O painel e o doctor leem daqui.
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { Pastas } from '../hooks/comum.ts'
import { destinoSkill, expandirHome } from './paths.ts'
import type { Config } from './tipos.ts'

export const MANIFESTO = '.agent-pool-skill.json'
/** Pasta de skills lida por cada agente; os demais leem `~/.agents/skills` direto. */
export const PASTA_AGENTE: Record<string, string> = {
  claude: '.claude/skills',
  codex: '.codex/skills',
  antigravity: '.gemini/config/skills',
}

export type Manifesto = { versao: string; hashes: Record<string, string> }
export type EstadoCopia = 'ok' | 'ausente' | 'desatualizada' | 'editada' | 'sem_origem'

function arquivos(raiz: string, dir = raiz): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name)
    return e.isDirectory() ? arquivos(raiz, p) : e.name === MANIFESTO ? [] : [relative(raiz, p).replace(/\\/g, '/')]
  })
}

export function hashes(raiz: string): Record<string, string> {
  return Object.fromEntries(
    arquivos(raiz)
      .sort()
      .map(f => [
        f,
        createHash('sha256')
          .update(readFileSync(join(raiz, f)))
          .digest('hex'),
      ]),
  )
}

function lerManifesto(destino: string): Manifesto | null {
  try {
    return JSON.parse(readFileSync(join(destino, MANIFESTO), 'utf8')) as Manifesto
  } catch {
    return null
  }
}

const iguais = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(a) === JSON.stringify(b)

/** Estado da cópia sem tocar em nada: `desatualizada` = versão ou conteúdo da origem mudou, `editada` = o usuário mexeu. */
export function estadoSkill(origem: string, home: string, versao: string): EstadoCopia {
  if (!existsSync(origem)) return 'sem_origem'
  const destino = destinoSkill(home)
  if (!existsSync(destino)) return 'ausente'
  const m = lerManifesto(destino)
  if (!m || !iguais(m.hashes, hashes(destino))) return 'editada'
  return m.versao === versao && iguais(m.hashes, hashes(origem)) ? 'ok' : 'desatualizada'
}

export const pastaSkillsDaConta = (home: string, pasta: string) => join(expandirHome(pasta, home), 'skills')

/** Pastas `skills` que recebem o link: a de cada agente e a de cada conta com pasta própria. */
export function pastasDeLink(home: string, agentes: string[], pastas: Pastas = {}): { agente: string; pasta: string }[] {
  return [
    ...agentes.filter(a => PASTA_AGENTE[a]).map(agente => ({ agente, pasta: join(home, PASTA_AGENTE[agente]) })),
    ...Object.entries(pastas).flatMap(([agente, lista]) =>
      (lista ?? []).map(p => ({ agente: `${agente}:${p}`, pasta: pastaSkillsDaConta(home, p) })),
    ),
  ]
}

/** Links que a instalação criaria: o caminho não existe (algo alheio no lugar é pulado, como em `ligar`). */
export function linksFaltando(home: string, agentes: string[], pastas?: Pastas): string[] {
  return pastasDeLink(home, agentes, pastas)
    .map(({ pasta }) => join(pasta, 'agent-pool'))
    .filter(alvo => {
      try {
        lstatSync(alvo)
        return false
      } catch {
        return true
      }
    })
}

export const nossoLink = (home: string, alvo: string) => {
  try {
    return lstatSync(alvo).isSymbolicLink() && resolve(dirname(alvo), readlinkSync(alvo)) === destinoSkill(home)
  } catch {
    return false
  }
}

/** Agentes das contas da config, sem repetir. */
export const agentesDaSkill = (c: Config): string[] => [...new Set(c.pool.contas.map(ct => ct.agente))]

/** Cópia que não trava a tela: em dia, ou editada pelo usuário (respeitada). */
export const skillPronta = (copia: EstadoCopia): boolean => copia === 'ok' || copia === 'editada'

/** Cópia mais links: `desatualizada` quando a cópia está em dia (ou editada) mas falta o link de um agente ou conta. */
export function situacaoSkill(origem: string, home: string, versao: string, agentes: string[], pastas: Pastas) {
  const copia = estadoSkill(origem, home, versao)
  const links = linksFaltando(home, agentes, pastas)
  return { copia, links, estado: skillPronta(copia) && links.length ? ('desatualizada' as const) : copia }
}
