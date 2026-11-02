// Instalador da skill: cópia presa à versão em ~/.agents/skills/agent-pool e um link por agente detectado.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { destinoSkill, paths } from '../core/paths.ts'
import type { Pastas } from '../hooks/comum.ts'

const MANIFESTO = '.agent-pool-skill.json'
/** Pasta de skills lida por cada agente; os demais leem `~/.agents/skills` direto. */
const PASTA_AGENTE: Record<string, string> = { claude: '.claude/skills', codex: '.codex/skills' }

export type ResultadoSkill = {
  copia: 'instalada' | 'atualizada' | 'ja' | 'editada' | 'forcada' | 'sem_origem' | 'erro'
  backup?: string
  links: { agente: string; estado: 'criado' | 'ja' | 'pulado' | 'erro'; detalhe?: string }[]
  avisos: string[]
}

type Manifesto = { versao: string; hashes: Record<string, string> }

function arquivos(raiz: string, dir = raiz): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? arquivos(raiz, p) : e.name === MANIFESTO ? [] : [relative(raiz, p).replace(/\\/g, '/')]
  })
}

function hashes(raiz: string): Record<string, string> {
  return Object.fromEntries(arquivos(raiz).sort().map((f) => [f, createHash('sha256').update(readFileSync(join(raiz, f))).digest('hex')]))
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
export function estadoSkill(origem: string, home: string, versao: string): 'ok' | 'ausente' | 'desatualizada' | 'editada' | 'sem_origem' {
  if (!existsSync(origem)) return 'sem_origem'
  const destino = destinoSkill(home)
  if (!existsSync(destino)) return 'ausente'
  const m = lerManifesto(destino)
  if (!m || !iguais(m.hashes, hashes(destino))) return 'editada'
  return m.versao === versao && iguais(m.hashes, hashes(origem)) ? 'ok' : 'desatualizada'
}

function ligar(destino: string, pasta: string): Omit<ResultadoSkill['links'][number], 'agente'> {
  const alvo = join(pasta, 'agent-pool')
  try {
    let st
    try {
      st = lstatSync(alvo)
    } catch {
      /* não existe */
    }
    if (st) {
      if (st.isSymbolicLink() && resolve(dirname(alvo), readlinkSync(alvo)) === destino) return { estado: 'ja' }
      return { estado: 'pulado', detalhe: `${alvo} já existe e não é o nosso link` }
    }
    mkdirSync(pasta, { recursive: true })
    // junction no Windows: não exige privilégio de administrador.
    symlinkSync(destino, alvo, 'junction')
    return { estado: 'criado' }
  } catch (e) {
    return { estado: 'erro', detalhe: (e as Error).message }
  }
}

/** Tira o nosso link de `<pasta>/skills/agent-pool`; pasta `skills` que é link para outra conta fica intacta. */
export function removerLinks(home: string, pastas: Pastas): void {
  for (const lista of Object.values(pastas)) {
    for (const pasta of lista ?? []) {
      const skills = join(pasta.startsWith('~') ? join(home, pasta.slice(1)) : pasta, 'skills')
      const alvo = join(skills, 'agent-pool')
      try {
        if (lstatSync(skills).isSymbolicLink()) continue
        if (lstatSync(alvo).isSymbolicLink() && resolve(dirname(alvo), readlinkSync(alvo)) === destinoSkill(home)) rmSync(alvo, { force: true })
      } catch {
        /* pasta ou link ausente: nada a tirar */
      }
    }
  }
}

/**
 * Copia `origem` para ~/.agents/skills/agent-pool e liga cada agente. Cópia editada pelo usuário é pulada com aviso;
 * `forcar` guarda a cópia atual em state/backup/ antes de sobrescrever.
 */
export function instalarSkill(origem: string, home: string, agentes: string[], opts: { versao: string; forcar?: boolean; pastas?: Pastas } = { versao: '0.0.0' }): ResultadoSkill {
  const r: ResultadoSkill = { copia: 'ja', links: [], avisos: [] }
  if (!existsSync(origem)) return { ...r, copia: 'sem_origem', avisos: [`origem da skill não encontrada: ${origem}`] }
  const destino = destinoSkill(home)
  try {
    const estado = estadoSkill(origem, home, opts.versao)
    if (estado === 'editada' && !opts.forcar) {
      r.copia = 'editada'
      r.avisos.push(`a skill em ${destino} foi editada: não foi sobrescrita (reinstale forçando para trocar, com backup)`)
    } else if (estado !== 'ok') {
      if (estado === 'editada') {
        mkdirSync(paths(home).backup, { recursive: true })
        r.backup = join(paths(home).backup, `skill-agent-pool-${Date.now()}`)
        cpSync(destino, r.backup, { recursive: true })
      }
      // Cópia nova ao lado e rename: nunca fica uma skill pela metade.
      const tmp = `${destino}.${process.pid}.novo`
      rmSync(tmp, { recursive: true, force: true })
      mkdirSync(dirname(destino), { recursive: true })
      cpSync(origem, tmp, { recursive: true })
      writeFileSync(join(tmp, MANIFESTO), JSON.stringify({ versao: opts.versao, hashes: hashes(tmp) } satisfies Manifesto, null, 2))
      rmSync(destino, { recursive: true, force: true })
      renameSync(tmp, destino)
      r.copia = estado === 'ausente' ? 'instalada' : estado === 'editada' ? 'forcada' : 'atualizada'
    }
  } catch (e) {
    return { ...r, copia: 'erro', avisos: [...r.avisos, (e as Error).message] }
  }
  for (const agente of agentes) {
    const pasta = PASTA_AGENTE[agente]
    if (!pasta) continue
    const l = ligar(destino, join(home, pasta))
    r.links.push({ agente, ...l })
    if (l.estado === 'pulado' || l.estado === 'erro') r.avisos.push(`${agente}: ${l.detalhe}`)
  }
  // Contas com pasta de config própria (CLAUDE_CONFIG_DIR etc.) leem as skills de <pasta>/skills; se for link para outra, o link já existe ("ja").
  for (const [agente, lista] of Object.entries(opts.pastas ?? {})) {
    for (const pasta of lista) {
      const l = ligar(destino, join(pasta.startsWith('~') ? join(home, pasta.slice(1)) : pasta, 'skills'))
      r.links.push({ agente: `${agente}:${pasta}`, ...l })
      if (l.estado === 'pulado' || l.estado === 'erro') r.avisos.push(`${agente} ${pasta}: ${l.detalhe}`)
    }
  }
  return r
}
