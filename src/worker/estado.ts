// Monta o Estado do painel a partir do núcleo. Lê disco, nunca mede: a cota e o ambiente vêm da última passada do ciclo.
import type { Detectada } from '../core/deteccao.ts'
import { versao } from '../core/index.ts'
import type { Paths } from '../core/paths.ts'
import { listarTestes } from '../core/fila/travas.ts'
import { lerVagas, ocupadasMaquina } from '../core/pool/vagas.ts'
import type { Config, Medida } from '../core/tipos.ts'
import type { Alerta, Conta, Cota, Estado, ItemFila } from '../protocol.ts'

const ANTIGA_MIN = 30
const TETO_ALERTA = 80
const PAPEIS = ['escritor', 'revisor', 'verificador', 'mecanico', 'segunda-opiniao', 'orquestra']

/** O que o ciclo aprende fora do caminho de leitura. */
export type Ambiente = { medidas: Medida[]; detectadas: Detectada[]; ramGb: number | null; orca: { rodando: boolean | null; versao: string | null } }
/** `rodando: null` = ainda não verificado (worker recém-religado): sem alerta até a primeira coleta. */
export const AMBIENTE_VAZIO: Ambiente = { medidas: [], detectadas: [], ramGb: null, orca: { rodando: null, versao: null } }

/** `medidaTs` e `agoraMs` em ms, a mesma unidade do pool e dos medidores. */
function cota(m: Medida | undefined, agoraMs: number): Cota | null {
  if (!m) return null
  const min = Math.max(0, Math.round((agoraMs - m.medidaTs) / 60_000))
  const estado = m.estado === 'ok' && min > ANTIGA_MIN ? 'antiga' : m.estado
  return {
    curta: m.curta,
    longa: m.longa,
    medida_ha_min: min,
    alerta_curta: (m.curta ?? 0) >= TETO_ALERTA,
    alerta_longa: (m.longa ?? 0) >= TETO_ALERTA,
    estado,
    acao: m.acao ?? null,
    erro: m.erro ?? null
  }
}

export function montarEstado(p: Paths, c: Config, erroConfig: string | null, amb: Ambiente, agoraMs = Date.now()): Estado {
  const vagas = lerVagas(p)
  const porConta = new Map(amb.medidas.map((m) => [m.conta, m]))
  const detectadas = new Map(amb.detectadas.map((d) => [d.nome, d]))
  const contas: Conta[] = c.pool.contas.map((ct) => {
    const ocupantes = vagas.filter((v) => v.conta === ct.nome)
    return {
      nome: ct.nome,
      agente: ct.agente,
      vagas: ct.vagas,
      usadas: ocupantes.length,
      peso: ct.peso,
      papeis: ct.papeis,
      ocupantes: ocupantes.map((v) => ({ dispatch: v.dono || null, desde: Number.isFinite(v.desde) && v.desde > 0 ? new Date(v.desde).toISOString() : null })),
      cota: cota(porConta.get(ct.nome), agoraMs),
      origem: ct.origem,
      rotulo: detectadas.get(ct.nome)?.rotulo ?? null,
      config: ct.config,
      comando: ct.comando,
      ativo: ct.ativo
    }
  })
  const testes = listarTestes(p)

  const alertas: Alerta[] = []
  if (erroConfig) alertas.push({ codigo: 'config_ilegivel', nivel: 'erro', params: { detalhe: erroConfig }, acao: p.config })
  if (amb.orca.rodando === false) alertas.push({ codigo: 'orca_indisponivel', nivel: 'aviso' })
  for (const ct of contas) {
    if (!ct.ativo) continue
    if (ct.cota?.estado === 'sem_login') alertas.push({ codigo: 'sem_login', nivel: 'erro', params: { conta: ct.nome }, ...(ct.cota.acao && { acao: ct.cota.acao }) })
    else if (ct.cota?.estado === 'erro') alertas.push({ codigo: 'erro_medida', nivel: 'aviso', params: { conta: ct.nome, ...(ct.cota.erro && { detalhe: ct.cota.erro }) } })
  }
  for (const t of testes) if (t.estado === 'parado') alertas.push({ codigo: 'teste_parado', nivel: 'aviso', params: { pid: t.pid, onde: t.projeto ?? t.worktree ?? '–' } })

  const f = c.fila
  const config: Record<ItemFila, string | number> = { modo: f.modo, vagas: f.vagas, vagas_projeto: f.vagasPorProjeto, teto: f.teto, processos: f.processos }
  return {
    gerado_em: new Date(agoraMs).toISOString(),
    alertas,
    saude: { plugin_versao: versao, orca: amb.orca },
    fila: { modo: f.modo, vagas: f.vagas, teto: f.teto, testes, config },
    pool: {
      teto: c.pool.teto,
      ram_min: c.pool.ramMinGb,
      escolha: c.pool.escolha,
      papeis_validos: PAPEIS,
      maquina: { usadas: ocupadasMaquina(p, c, agoraMs), teto: c.pool.teto },
      contas
    }
  }
}
