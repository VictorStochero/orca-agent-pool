// Instalador da skill: cópia presa à versão em ~/.agents/skills/agent-pool e um link por agente detectado.
import { cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, rmSync, type Stats, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { destinoSkill } from '../core/paths.ts'
import { estadoSkill, hashes, MANIFESTO, type Manifesto, nossoLink, PASTA_AGENTE, pastaSkillsDaConta, pastasDeLink } from '../core/skill.ts'
import type { Pastas } from '../hooks/comum.ts'

export type ResultadoSkill = {
  copia: 'instalada' | 'atualizada' | 'ja' | 'editada' | 'sem_origem' | 'erro'
  links: { agente: string; estado: 'criado' | 'ja' | 'pulado' | 'erro'; detalhe?: string }[]
  avisos: string[]
}

function ligar(destino: string, pasta: string): Omit<ResultadoSkill['links'][number], 'agente'> {
  const alvo = join(pasta, 'agent-pool')
  try {
    let st: Stats | undefined
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

/**
 * Tira o nosso link de `<pasta>/skills/agent-pool`. Pasta `skills` que é link para outra conta fica intacta, salvo em
 * `atravessar` (Desinstalar), onde o link nosso criado através dela também sai.
 */
export function removerLinks(home: string, pastas: Pastas, atravessar = false): void {
  for (const lista of Object.values(pastas)) {
    for (const pasta of lista ?? []) {
      const skills = pastaSkillsDaConta(home, pasta)
      try {
        if (!atravessar && lstatSync(skills).isSymbolicLink()) continue
      } catch {
        continue // pasta ausente: nada a tirar
      }
      const alvo = join(skills, 'agent-pool')
      if (nossoLink(home, alvo)) rmSync(alvo, { force: true })
    }
  }
}

/** Desinstalação: os nossos links (pastas dos agentes e das contas) e a cópia em ~/.agents/skills/agent-pool. */
export function removerSkill(home: string, pastas: Pastas): void {
  for (const pasta of Object.values(PASTA_AGENTE)) {
    const alvo = join(home, pasta, 'agent-pool')
    if (nossoLink(home, alvo)) rmSync(alvo, { force: true })
  }
  removerLinks(home, pastas, true)
  rmSync(destinoSkill(home), { recursive: true, force: true })
}

/**
 * Copia `origem` para ~/.agents/skills/agent-pool e liga cada agente. Cópia editada pelo usuário é pulada com aviso.
 */
export function instalarSkill(
  origem: string,
  home: string,
  agentes: string[],
  opts: { versao: string; pastas?: Pastas } = { versao: '0.0.0' },
): ResultadoSkill {
  const r: ResultadoSkill = { copia: 'ja', links: [], avisos: [] }
  if (!existsSync(origem)) return { ...r, copia: 'sem_origem', avisos: [`origem da skill não encontrada: ${origem}`] }
  const destino = destinoSkill(home)
  try {
    const estado = estadoSkill(origem, home, opts.versao)
    if (estado === 'editada') {
      r.copia = 'editada'
      r.avisos.push(`a cópia em ${destino} foi editada e não foi trocada; para reinstalar, apague a pasta e clique Instalar`)
    } else if (estado !== 'ok') {
      // Cópia nova ao lado e rename: nunca fica uma skill pela metade.
      const tmp = `${destino}.${process.pid}.novo`
      rmSync(tmp, { recursive: true, force: true })
      mkdirSync(dirname(destino), { recursive: true })
      cpSync(origem, tmp, { recursive: true })
      writeFileSync(join(tmp, MANIFESTO), JSON.stringify({ versao: opts.versao, hashes: hashes(tmp) } satisfies Manifesto, null, 2))
      rmSync(destino, { recursive: true, force: true })
      renameSync(tmp, destino)
      r.copia = estado === 'ausente' ? 'instalada' : 'atualizada'
    }
  } catch (e) {
    return { ...r, copia: 'erro', avisos: [...r.avisos, (e as Error).message] }
  }
  // Contas com pasta de config própria (CLAUDE_CONFIG_DIR etc.) leem as skills de <pasta>/skills; se for link para outra, o link já existe ("ja").
  for (const { agente, pasta } of pastasDeLink(home, agentes, opts.pastas)) {
    const l = ligar(destino, pasta)
    r.links.push({ agente, ...l })
    if (l.estado === 'pulado' || l.estado === 'erro') r.avisos.push(`${agente}: ${l.detalhe}`)
  }
  return r
}
