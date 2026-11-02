// Requisitos do painel: lógica sem E/S própria (o worker injeta o CLI do Orca e as checagens de disco).
import type { DetalheRequisito, IdRequisito, RequisitoItem, Requisitos } from '../protocol.ts'

export const ORCA_MINIMO = '1.4.246'
const VALIDADE_MS = 60_000
const INSTALAVEIS = ['orchestration', 'skill', 'lancador', 'hooks'] as const
export type IdInstalavel = (typeof INSTALAVEIS)[number]

export type DepsRequisitos = {
  /** Roda o CLI do Orca e devolve o stdout; rejeita se falhar. */
  orca: (args: string[]) => Promise<string>
  skill: () => { estado: 'ok' | 'ausente' | 'desatualizada' | 'editada' | 'sem_origem' }
  lancador: () => boolean
  /** Hooks dos agentes que os suportam; `removido` = o usuário tirou de propósito (não trava a tela). */
  hooks: () => { agente: string; estado: 'instalado' | 'ausente' | 'erro'; detalhe?: string; removido?: boolean }[]
  /** Instala o item; rejeita se não conseguir. */
  instalar: (id: IdInstalavel) => Promise<void>
  agora?: () => number
}

/** Compara `a.b.c`; ausente ou ilegível devolve null. */
export function versaoAtende(texto: string, minimo = ORCA_MINIMO): boolean | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(texto)
  if (!m) return null
  const a = m.slice(1, 4).map(Number)
  const b = minimo.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return true
}

/** `orca skills installed --json` -> nomes; lança se o formato não for o esperado. */
export function lerSkills(saida: string): string[] {
  const lista = (JSON.parse(saida) as { result?: { skills?: unknown } })?.result?.skills
  if (!Array.isArray(lista) || lista.some((s) => typeof (s as { name?: unknown })?.name !== 'string')) throw new Error('formato inesperado')
  return lista.map((s) => (s as { name: string }).name)
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e))

const naoVerificado = (id: IdRequisito, motivo: string, instalar?: true): RequisitoItem => ({
  id,
  ok: false,
  detalhe: { codigo: 'nao_verificado', valor: motivo },
  ...(instalar && { instalar })
})

export function criarRequisitos(deps: DepsRequisitos) {
  const agora = deps.agora ?? Date.now
  let guardado: { valor: Requisitos; em: number } | undefined
  let emVoo: Promise<Requisitos> | undefined

  async function coletar(): Promise<Requisitos> {
    const [versao, skills] = await Promise.allSettled([deps.orca(['--version']), deps.orca(['skills', 'installed', '--json'])])
    const itens: RequisitoItem[] = []

    if (versao.status === 'rejected') itens.push(naoVerificado('orca', mensagem(versao.reason)))
    else {
      const atende = versaoAtende(versao.value)
      const lida = versao.value.trim()
      itens.push(
        atende === null
          ? naoVerificado('orca', lida.slice(0, 40))
          : { id: 'orca', ok: atende, detalhe: { codigo: atende ? 'versao' : 'versao_antiga', valor: lida } }
      )
    }

    try {
      if (skills.status === 'rejected') throw skills.reason
      const orch = lerSkills(skills.value).includes('orchestration')
      itens.push({ id: 'orchestration', ok: orch, detalhe: { codigo: orch ? 'instalada' : 'nao_instalada' }, ...(!orch && { instalar: true as const }) })
    } catch (e) {
      itens.push(naoVerificado('orchestration', mensagem(e), true))
    }

    const s = deps.skill().estado
    const skillOk = s === 'ok' || s === 'editada' // editada pelo usuário é respeitada, não trava a tela
    itens.push({
      id: 'skill',
      ok: skillOk,
      detalhe: { codigo: { ok: 'instalada', editada: 'instalada_editada', ausente: 'nao_instalada', desatualizada: 'desatualizada', sem_origem: 'sem_origem' }[s] } as DetalheRequisito,
      ...(!skillOk && s !== 'sem_origem' && { instalar: true as const })
    })

    const lancadorOk = deps.lancador()
    itens.push({ id: 'lancador', ok: lancadorOk, detalhe: { codigo: lancadorOk ? 'instalado' : 'nao_instalado' }, ...(!lancadorOk && { instalar: true as const }) })

    const hooks = deps.hooks()
    const faltam = hooks.filter((h) => h.estado !== 'instalado' && !h.removido)
    itens.push({
      id: 'hooks',
      ok: faltam.length === 0,
      detalhe:
        hooks.length === 0
          ? { codigo: 'hooks_nenhum' }
          : {
              codigo: 'hooks',
              // Quem falta mostra o estado real; o resto, instalado ou removido por escolha.
              agentes: (faltam.length > 0 ? faltam : hooks).map((h) => ({
                agente: h.agente,
                situacao: faltam.length > 0 ? (h.estado === 'erro' ? 'erro' : 'ausente') : h.removido && h.estado !== 'instalado' ? 'removido' : 'instalado',
                ...(faltam.length > 0 && h.estado === 'erro' && h.detalhe && { erro: h.detalhe })
              }))
            },
      ...(faltam.length > 0 && { instalar: true as const })
    })

    return { ok: itens.every((i) => i.ok), itens }
  }

  function ler(): Promise<Requisitos> {
    if (guardado && agora() - guardado.em < VALIDADE_MS) return Promise.resolve(guardado.valor)
    emVoo ??= coletar()
      .then((valor) => {
        guardado = { valor, em: agora() }
        return valor
      })
      .finally(() => {
        emVoo = undefined
      })
    return emVoo
  }

  return {
    ler,
    /** Instala o item e devolve os requisitos já relidos; qualquer outro id é recusado. */
    async instalar(id: unknown): Promise<Requisitos> {
      if (!INSTALAVEIS.includes(id as IdInstalavel)) throw Object.assign(new Error(String(id)), { code: 'instalacao_recusada' })
      await emVoo?.catch(() => undefined) // uma leitura em curso gravaria o resultado velho depois da instalação
      try {
        await deps.instalar(id as IdInstalavel)
      } catch (e) {
        throw Object.assign(new Error(mensagem(e)), { code: 'instalacao_falhou' })
      } finally {
        guardado = undefined
      }
      return ler()
    },
    /** Descarta o que está guardado (hooks ou lançador mudaram por outro caminho). */
    invalidar() {
      guardado = undefined
    }
  }
}
