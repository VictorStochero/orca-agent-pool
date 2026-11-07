// Instalação sob demanda (lançador, skill e hooks): o que o painel mostra em Requisitos e o que os botões gravam.
import { resolve } from 'node:path'
import { carregar } from '../core/config.ts'
import { aplicar } from '../core/config-chaves.ts'
import { versao } from '../core/index.ts'
import { argsLancador, estadoLancador, instalarLancador, lancadorEsperado as lancadorEsperadoEm } from '../core/lancador.ts'
import { destinoSkill, expandirHome, type Paths } from '../core/paths.ts'
import { agentesDaSkill, situacaoSkill, skillPronta } from '../core/skill.ts'
import type { Config } from '../core/tipos.ts'
import {
  AGENTES_HOOK,
  type AgenteHook,
  agentesComHook,
  type EstadoHook,
  estadoHooks,
  instalarHooks,
  type Pastas,
  pastaPadrao,
  pastasDasContas,
  removerHooks,
  soAtivas,
} from '../hooks/comum.ts'
import type { EstadoHookAgente, IdInstalavel } from '../protocol.ts'
import { instalarSkill, removerLinks } from './skill.ts'

export function falha(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** Config ilegível vira null: quem chama decide o fallback (o que grava usa `lerConfig`, que recusa). */
export function configOuNull(p: Paths): Config | null {
  try {
    return carregar(p)
  } catch {
    return null
  }
}

export type DepsInstalacao = {
  home: string
  p: Paths
  /** Caminho do lançador que os hooks chamam. */
  lancador: string
  origemSkill: string
  raizPlugin: string
  log: (mensagem: string) => void
  /** Config para gravar: relança como `config_recusada` quando ilegível. */
  lerConfig: () => Config
  /** Roda o CLI do Orca e devolve o stdout; rejeita se falhar. */
  orca: (args: string[]) => Promise<string>
}

export function criarInstalacao(deps: DepsInstalacao) {
  const { home, p, lancador, origemSkill, raizPlugin, log, lerConfig, orca } = deps
  const curto = (f: string) => (f.startsWith(home) ? `~${f.slice(home.length)}` : f)
  const real = (pasta: string) => resolve(expandirHome(pasta, home))
  const pastasDe = (c: Config): Pastas => pastasDasContas(c, home)

  // Requisitos e Instalar olham só as contas ativas; config ilegível: só a pasta padrão de cada agente.
  const pastasAtuais = (): Pastas => {
    const c = configOuNull(p)
    return c ? pastasDe(soAtivas(c)) : {}
  }
  // Remoção alcança também a conta desativada ou apagada que ainda tem o hook; config ilegível recusa em vez de remover pela metade.
  const pastasParaRemover = (): Pastas => pastasDe(lerConfig())

  // Conta apagada ou com a pasta trocada: hook e link saem da pasta que deixou de ser usada, antes de a config mudar.
  // Fica o que outra conta ainda usa, inclusive a pasta padrão do agente (conta sem `config`), comparado pelo caminho real.
  const removerRastroDasContas = (valores: Record<string, string>) => {
    if (!Object.keys(valores).some(k => k.startsWith('conta.'))) return
    const c = lerConfig()
    const depois = aplicar(c, valores) // recusa antes de mexer em disco
    const ficam = new Set([
      ...Object.values(pastasDe(depois)).flat().map(real),
      ...agentesComHook(depois).map(a => real(pastaPadrao(a, home))),
    ])
    const pastas: Pastas = {}
    for (const [a, lista] of Object.entries(pastasDe(c))) pastas[a as AgenteHook] = lista.filter(d => !ficam.has(real(d)))
    const erro = removerHooks(
      home,
      AGENTES_HOOK.filter(a => pastas[a]?.length),
      pastas,
      true,
    ).find(x => x.estado === 'erro')
    if (erro) throw falha('hooks_falhou', `${erro.pasta}: ${erro.erro ?? 'erro'}`)
    removerLinks(home, pastas)
  }

  const lancadorEsperado = () => lancadorEsperadoEm(p.bin, raizPlugin)
  // Conteúdo diferente = aponta para outra pasta do plugin ou do Orca (atualização): trava até instalar de novo.
  const situacaoLancador = () => estadoLancador(lancadorEsperado())
  const gravarLancador = () => instalarLancador(...argsLancador(p.bin, raizPlugin))

  // Cópia em dia mas faltando o link de um agente ou conta: pendente, para o clique criar o link.
  const situacaoSkillAgora = () => {
    const c = configOuNull(p)
    const ativas = c && soAtivas(c)
    return situacaoSkill(origemSkill, home, versao, ativas ? agentesDaSkill(ativas) : [], ativas ? pastasDe(ativas) : {})
  }
  const instalarSkillAgora = (c: Config) => {
    const ativas = soAtivas(c)
    const r = instalarSkill(origemSkill, home, agentesDaSkill(ativas), { versao, pastas: pastasDe(ativas) })
    for (const a of r.avisos) log(`skill: ${a}`)
    if (r.copia === 'erro' || r.copia === 'sem_origem') throw new Error(r.copia === 'sem_origem' ? 'skill_sem_origem' : r.avisos.join('; '))
  }

  const instalarHooksAgora = (c: Config, agentes: AgenteHook[]) => {
    const erros = instalarHooks(home, agentes, lancador, pastasDe(soAtivas(c))).filter(x => x.estado === 'erro')
    for (const x of erros) log(`hooks ${x.agente} (${x.pasta}): ${x.erro}`)
    if (erros.length) throw new Error(erros.map(x => `${x.agente} (${x.pasta}): ${x.erro}`).join('; '))
  }

  // Um item por agente: a pior situação entre a pasta padrão e as das contas (erro > ausente > desatualizado > instalado); `arquivos` = os que o Instalar vai gravar (sem o hook ou desatualizados).
  const listaHooks = (): EstadoHookAgente[] => {
    const ordem = { instalado: 0, desatualizado: 1, ausente: 2, erro: 3 } as const
    const porAgente = new Map<string, EstadoHook[]>()
    for (const h of estadoHooks(home, lancador, pastasAtuais())) porAgente.set(h.agente, [...(porAgente.get(h.agente) ?? []), h])
    return [...porAgente].map(([agente, grupo]) => {
      const pior = grupo.reduce((a, b) => (ordem[b.estado] > ordem[a.estado] ? b : a))
      return {
        agente,
        estado: pior.estado,
        ...(pior.erro && { detalhe: `${pior.pasta}: ${pior.erro}` }),
        arquivos: grupo.filter(h => h.estado === 'ausente' || h.estado === 'desatualizado').map(h => curto(h.arquivo)),
      }
    })
  }
  const hooksExigidos = (): EstadoHookAgente[] => {
    const c = configOuNull(p)
    const alvo = c ? agentesComHook(soAtivas(c)) : []
    return listaHooks().filter(h => alvo.includes(h.agente as AgenteHook))
  }

  return {
    pastasParaRemover,
    removerRastroDasContas,
    listaHooks,
    instalarHooksAgora,
    /** Para o requisito `skill`. */
    estadoSkill: () => situacaoSkillAgora().estado,
    /** Para o requisito `lancador`. */
    estadoLancador: situacaoLancador,
    caminhoLancador: curto(lancador),
    hooksExigidos,
    /** O que a instalação do item vai gravar, para o usuário consentir sabendo. */
    arquivos(id: IdInstalavel): string[] {
      if (id === 'lancador') return Object.keys(lancadorEsperado()).map(curto)
      if (id === 'hooks') return hooksExigidos().flatMap(h => h.arquivos ?? [])
      if (id !== 'skill') return [] // orchestration: quem grava é o próprio Orca
      const s = situacaoSkillAgora()
      return [...(skillPronta(s.copia) ? [] : [destinoSkill(home)]), ...s.links].map(curto)
    },
    async instalar(id: IdInstalavel): Promise<void> {
      if (id === 'orchestration') await orca(['skills', 'install', '--skill', 'orchestration', '--json'])
      else if (id === 'lancador') gravarLancador()
      else if (id === 'skill') instalarSkillAgora(lerConfig())
      else {
        const c = lerConfig()
        instalarHooksAgora(c, agentesComHook(soAtivas(c)))
      }
    },
  }
}
