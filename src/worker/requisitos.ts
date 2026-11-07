// Requisitos do painel: lógica sem E/S própria (o worker injeta o CLI do Orca e as checagens de disco).

import { skillPronta } from '../core/skill.ts'
import type { SituacaoHook } from '../hooks/comum.ts'
import type { DetalheRequisito, IdInstalavel, IdRequisito, RequisitoItem, Requisitos } from '../protocol.ts'

export const ORCA_MINIMO = '1.4.247'
const VALIDADE_MS = 60_000
const INSTALAVEIS: readonly IdInstalavel[] = ['orchestration', 'skill', 'lancador', 'hooks']

export type DepsRequisitos = {
  /** Roda o CLI do Orca e devolve o stdout; rejeita se falhar. */
  orca: (args: string[]) => Promise<string>
  skill: () => { estado: 'ok' | 'ausente' | 'desatualizada' | 'editada' | 'sem_origem' }
  lancador: () => 'ok' | 'ausente' | 'desatualizado'
  /** Caminho do lançador mostrado no detalhe quando instalado. */
  caminhoLancador?: string
  /** Hooks dos agentes que os suportam; todos obrigatórios. */
  hooks: () => { agente: string; estado: SituacaoHook; detalhe?: string }[]
  /** O que a instalação do item vai gravar, para o usuário consentir sabendo. */
  arquivos?: (id: IdInstalavel) => string[]
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
  if (!Array.isArray(lista) || lista.some(s => typeof (s as { name?: unknown })?.name !== 'string')) throw new Error('formato inesperado')
  return lista.map(s => (s as { name: string }).name)
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e))

const naoVerificado = (id: IdRequisito, motivo: string, instalar?: true): RequisitoItem => ({
  id,
  ok: false,
  detalhe: { codigo: 'nao_verificado', valor: motivo },
  ...(instalar && { instalar }),
})

export function criarRequisitos(deps: DepsRequisitos) {
  const agora = deps.agora ?? Date.now
  let guardado: { valor: Requisitos; em: number } | undefined
  let emVoo: Promise<Requisitos> | undefined
  // Coleta começada antes de uma invalidação leu o estado velho: o resultado dela não é guardado nem reaproveitado.
  let geracao = 0

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
          : { id: 'orca', ok: atende, detalhe: { codigo: atende ? 'versao' : 'versao_antiga', valor: lida } },
      )
    }

    try {
      if (skills.status === 'rejected') throw skills.reason
      const orch = lerSkills(skills.value).includes('orchestration')
      itens.push({
        id: 'orchestration',
        ok: orch,
        detalhe: { codigo: orch ? 'instalada' : 'nao_instalada' },
        ...(!orch && { instalar: true as const }),
      })
    } catch (e) {
      itens.push(naoVerificado('orchestration', mensagem(e), true))
    }

    const s = deps.skill().estado
    const skillOk = skillPronta(s)
    itens.push({
      id: 'skill',
      ok: skillOk,
      detalhe: {
        codigo: {
          ok: 'instalada',
          editada: 'instalada_editada',
          ausente: 'nao_instalada',
          desatualizada: 'desatualizada',
          sem_origem: 'sem_origem',
        }[s],
      } as DetalheRequisito,
      ...(!skillOk && s !== 'sem_origem' && { instalar: true as const }),
    })

    const l = deps.lancador()
    itens.push({
      id: 'lancador',
      ok: l === 'ok',
      detalhe:
        l === 'ok'
          ? { codigo: 'instalado', ...(deps.caminhoLancador && { valor: deps.caminhoLancador }) }
          : { codigo: l === 'ausente' ? 'nao_instalado' : 'desatualizado' },
      ...(l !== 'ok' && { instalar: true as const }),
    })

    const hooks = deps.hooks()
    const faltam = hooks.filter(h => h.estado !== 'instalado')
    itens.push({
      id: 'hooks',
      ok: faltam.length === 0,
      detalhe:
        hooks.length === 0
          ? { codigo: 'hooks_nenhum' }
          : {
              codigo: 'hooks',
              agentes: hooks.map(h => ({
                agente: h.agente,
                situacao: h.estado,
                ...(h.estado === 'erro' && h.detalhe && { erro: h.detalhe }),
              })),
            },
      ...(faltam.length > 0 && { instalar: true as const }),
    })

    for (const i of itens) if (i.instalar && i.id !== 'orca' && deps.arquivos) i.arquivos = deps.arquivos(i.id)
    return { ok: itens.every(i => i.ok), itens }
  }

  function ler(): Promise<Requisitos> {
    if (guardado && agora() - guardado.em < VALIDADE_MS) return Promise.resolve(guardado.valor)
    const minha = geracao
    emVoo ??= coletar()
      .then(valor => {
        if (minha === geracao) guardado = { valor, em: agora() }
        return valor
      })
      .finally(() => {
        if (minha === geracao) emVoo = undefined
      })
    return emVoo
  }

  /** Descarta o guardado e a coleta em voo (hooks, lançador ou skill mudaram): a próxima leitura coleta de novo. */
  function invalidar(): void {
    geracao++
    guardado = undefined
    emVoo = undefined
  }

  return {
    ler,
    /** Instala o item e devolve os requisitos já relidos; qualquer outro id é recusado. */
    async instalar(id: unknown): Promise<Requisitos> {
      if (!INSTALAVEIS.includes(id as IdInstalavel)) throw Object.assign(new Error(String(id)), { code: 'instalacao_recusada' })
      try {
        await deps.instalar(id as IdInstalavel)
      } catch (e) {
        throw Object.assign(new Error(mensagem(e)), { code: 'instalacao_falhou' })
      } finally {
        invalidar()
      }
      return ler()
    },
    /** Releitura na hora, sem aproveitar guardado nem coleta em voo. */
    reler(): Promise<Requisitos> {
      invalidar()
      return ler()
    },
    invalidar,
  }
}
