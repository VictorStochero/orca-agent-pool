// `orca plugin check` desenha o painel uma vez por cenário.
import { defineCheck, hostError } from 'orca/testing'
import type { Requisitos } from '../protocol'
import { estadoComAlertas, estadoExemplo } from './fixtures'

// A vigília (auto.assistir) é um long-poll que nunca responde: o check esperaria para sempre; ele só confere o desenho.
const semVigia = {
  'requisitos.ler': (): Requisitos => ({ ok: true, itens: [] }),
  'hooks.estado': () => [
    { agente: 'claude', estado: 'instalado' as const },
    { agente: 'codex', estado: 'ausente' as const },
  ],
  'auto.assistir': () => {
    throw hostError('unavailable', 'sem vigília no check')
  },
}

const cenarios = {
  carregado: { requests: { ...semVigia, 'estado.ler': () => estadoExemplo } },
  // Bloco Atenção: conta sem login, erro do Orca, Orca fora do ar e teste parado.
  comAlertas: { requests: { ...semVigia, 'estado.ler': () => estadoComAlertas } },
  // Conta inativa ("não utilizada") na tabela do Pool.
  contaInativa: {
    requests: {
      ...semVigia,
      'estado.ler': () => ({
        ...estadoExemplo,
        pool: { ...estadoExemplo.pool, contas: estadoExemplo.pool.contas.map(c => ({ ...c, ativo: false })) },
      }),
    },
  },
  vazio: {
    requests: {
      ...semVigia,
      'estado.ler': () => ({
        ...estadoExemplo,
        fila: { ...estadoExemplo.fila, testes: [] },
        pool: { ...estadoExemplo.pool, contas: [] },
      }),
    },
  },
  requisitosFaltando: {
    requests: {
      ...semVigia,
      'requisitos.ler': (): Requisitos => ({
        ok: false,
        itens: [
          { id: 'orca', ok: true, detalhe: { codigo: 'versao', valor: '1.4.247' } },
          { id: 'orchestration', ok: false, detalhe: { codigo: 'nao_instalada' }, instalar: true },
          {
            id: 'skill',
            ok: false,
            detalhe: { codigo: 'nao_instalada' },
            instalar: true,
            arquivos: ['~/.agents/skills/agent-pool', '~/.claude/skills/agent-pool', '~/.codex/skills/agent-pool'],
          },
          {
            id: 'lancador',
            ok: false,
            detalhe: { codigo: 'nao_instalado' },
            instalar: true,
            arquivos: ['~/.agents/bin/agent-pool', '~/.agents/bin/agent-pool.cmd'],
          },
          {
            id: 'hooks',
            ok: false,
            detalhe: { codigo: 'hooks', agentes: [{ agente: 'codex', situacao: 'ausente' }] },
            instalar: true,
            arquivos: ['~/.codex/hooks.json'],
          },
        ],
      }),
    },
  },
  coletorFalhou: {
    requests: {
      ...semVigia,
      'estado.ler': () => {
        throw hostError('coletor_falhou', 'agent-pool status failed')
      },
    },
  },
}

export default defineCheck(cenarios)
