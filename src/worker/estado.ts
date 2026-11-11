// Monta o Estado do painel a partir do núcleo. Lê disco, nunca mede: a cota e o ambiente vêm da última passada do ciclo.
import { resolve } from 'node:path'
import { PADRAO } from '../core/config.ts'
import type { Detectada } from '../core/deteccao.ts'
import { listarTestesAsync } from '../core/fila/travas.ts'
import { versao } from '../core/index.ts'
import { pastaDaConta } from '../core/medidas/claude.ts'
import { motivoNaoConfigurada } from '../core/motivo.ts'
import type { Paths } from '../core/paths.ts'
import { CURTA_MAX, LONGA_MAX } from '../core/pool/escolha.ts'
import { limiteSeguido, medidaEfetiva, modeloEfetivo } from '../core/pool/modelo.ts'
import { ocupacaoViva } from '../core/pool/vagas.ts'
import { sessoesAbertas } from '../core/sessoes.ts'
import { type Config, type Medida, PAPEIS } from '../core/tipos.ts'
import type { Alerta, Conta, Cota, Estado, ItemFila } from '../protocol.ts'

const ANTIGA_MIN = 30

/** O que o ciclo aprende fora do caminho de leitura. */
export type Ambiente = {
  medidas: Medida[]
  detectadas: Detectada[]
  ramGb: number | null
  orca: { rodando: boolean | null; versao: string | null }
}
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
    // Mesmo corte do pool: no teto exato a conta segue apta e sem alerta.
    alerta_curta: (m.curta ?? 0) > CURTA_MAX,
    alerta_longa: (m.longa ?? 0) > LONGA_MAX,
    limites: m.limites ?? [],
    estado,
    acao: m.acao ?? null,
    erro: m.erro ?? null,
    motivo: m.estado === 'nao_configurada' ? motivoNaoConfigurada(m.erro) : null,
  }
}

/** Sem bloquear o processo nas consultas de processo e de trava (worker). */
export async function montarEstado(p: Paths, c: Config, erroConfig: string | null, amb: Ambiente, agoraMs = Date.now()): Promise<Estado> {
  const oc = await ocupacaoViva(p, c, agoraMs)
  const porPasta = new Map<string, string[]>()
  const porConta = new Map(amb.medidas.map(m => [m.conta, m]))
  const detectadas = new Map(amb.detectadas.map(d => [d.nome, d]))
  const contas: Conta[] = c.pool.contas.map(ct => {
    const medida = porConta.get(ct.nome)
    const ocupantes = oc.vivas.filter(v => v.conta === ct.nome)
    let sessoes: string[] | null = null
    if (ct.agente === 'claude' && ct.origem === 'manual') {
      // A mesma pasta escrita de outro jeito (barra normal, barra no fim) conta uma vez no total.
      const pasta = resolve(pastaDaConta(ct, p.home))
      sessoes = porPasta.get(pasta) ?? sessoesAbertas(pasta)
      porPasta.set(pasta, sessoes)
    }
    return {
      nome: ct.nome,
      agente: ct.agente,
      vagas: ct.vagas,
      usadas: oc.porConta.get(ct.nome) ?? 0,
      peso: ct.peso,
      papeis: ct.papeis,
      ocupantes: ocupantes.map(v => ({
        dispatch: v.dono || null,
        desde: Number.isFinite(v.desde) && v.desde > 0 ? new Date(v.desde).toISOString() : null,
      })),
      sessoes,
      agentes: oc.agentes.get(ct.nome) ?? null,
      cota: cota(medida && medidaEfetiva(ct, medida), agoraMs),
      origem: ct.origem,
      rotulo: detectadas.get(ct.nome)?.rotulo ?? null,
      config: ct.config,
      comando: ct.comando,
      modelo: ct.modelo,
      modelo_efetivo: modeloEfetivo(ct),
      limite_seguido: limiteSeguido(ct, medida)?.nome ?? null,
      ativo: ct.ativo,
    }
  })
  const testes = await listarTestesAsync(p)

  const alertas: Alerta[] = []
  if (erroConfig) alertas.push({ codigo: 'config_ilegivel', nivel: 'erro', params: { detalhe: erroConfig }, acao: p.config })
  if (amb.orca.rodando === false) alertas.push({ codigo: 'orca_indisponivel', nivel: 'aviso' })
  for (const ct of contas) {
    if (!ct.ativo) continue
    if (ct.cota?.estado === 'sem_login')
      alertas.push({ codigo: 'sem_login', nivel: 'erro', params: { conta: ct.nome }, ...(ct.cota.acao && { acao: ct.cota.acao }) })
    else if (ct.cota?.estado === 'erro')
      alertas.push({ codigo: 'erro_medida', nivel: 'aviso', params: { conta: ct.nome, ...(ct.cota.erro && { detalhe: ct.cota.erro }) } })
  }
  for (const t of testes)
    if (t.estado === 'parado')
      alertas.push({ codigo: 'teste_parado', nivel: 'aviso', params: { pid: t.pid, onde: t.projeto ?? t.worktree ?? '–' } })

  const f = c.fila
  const semSaidaMin = f.semSaidaMin ?? PADRAO.fila.semSaidaMin
  const limiteMs = (semSaidaMin ?? 0) * 60_000
  for (const t of testes) {
    const sem = agoraMs - (t.saida?.ts ?? t.desde_ts ?? agoraMs)
    if (t.estado === 'execucao' && limiteMs > 0 && sem > limiteMs)
      alertas.push({
        codigo: 'teste_sem_saida',
        nivel: 'aviso',
        params: { pid: t.pid, onde: t.projeto ?? t.worktree ?? '–', min: Math.floor(sem / 60_000) },
      })
  }
  const config: Record<ItemFila, string | number> = {
    modo: f.modo,
    vagas: f.vagas,
    vagas_projeto: f.vagasPorProjeto,
    teto: f.teto,
    processos: f.processos,
    sem_saida_min: semSaidaMin ?? 0,
    limpar_bancos: f.limparBancos ? 'sim' : 'nao',
  }
  return {
    gerado_em: new Date(agoraMs).toISOString(),
    alertas,
    saude: { plugin_versao: versao, orca: amb.orca },
    fila: { modo: f.modo, vagas: f.vagas, teto: f.teto, testes, config },
    pool: {
      teto: c.pool.teto,
      ram_min: c.pool.ramMinGb,
      escolha: c.pool.escolha,
      papeis_validos: [...PAPEIS],
      maquina: { usadas: oc.maquina, teto: c.pool.teto },
      sessoes: [...porPasta.values()].reduce((n, s) => n + s.length, 0),
      contas,
    },
  }
}
