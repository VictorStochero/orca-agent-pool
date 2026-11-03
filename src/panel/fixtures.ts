// Estado de exemplo compartilhado pelos testes e pelos cenários do `orca plugin check`.
import type { Estado } from '../protocol'

export const estadoExemplo: Estado = {
  gerado_em: '2026-11-02T10:00:00-03:00',
  alertas: [],
  saude: { plugin_versao: '0.1.0', orca: { rodando: true, versao: '1.4.246' } },
  fila: {
    modo: 'global',
    vagas: 5,
    teto: 5,
    testes: [
      { pid: 4242, estado: 'execucao', recurso: 'mysql 127.0.0.1:3308/app_test', worktree: '/work/wt-um', projeto: 'wt-um', comando: 'runner tests/X.php', fila: null, desde_ts: 1793650465000 },
      { pid: 4120, estado: 'aguardando', recurso: 'mysql 127.0.0.1:3308/app_test', worktree: '/work/wt-tres', projeto: 'wt-tres', comando: 'php artisan test', fila: null, desde_ts: 1793650500000 },
      { pid: 99, estado: 'parado', recurso: 'container exec-1', worktree: '/work/wt-dois', projeto: 'wt-dois', comando: null, fila: null, desde_ts: 1793640000000 }
    ],
    config: {
      modo: 'global',
      vagas: 5,
      vagas_projeto: 1,
      teto: 5,
      processos: 8
    }
  },
  pool: {
    teto: 4,
    ram_min: 3,
    escolha: 'ritmo',
    papeis_validos: ['escritor', 'revisor', 'verificador', 'mecanico', 'segunda-opiniao', 'orquestra'],
    maquina: { usadas: 1, teto: 4 },
    sessoes: 2,
    contas: [
      {
        nome: 'main',
        agente: 'claude',
        vagas: 2,
        usadas: 1,
        peso: 10,
        papeis: ['escritor', 'revisor'],
        ocupantes: [{ dispatch: 'ctx_a', desde: '2026-11-02T13:00:00Z' }],
        sessoes: ['orca-agent-pool-b6', 'gestaosmart'],
        agentes: ['orca-agent-pool-b6'],
        origem: 'manual',
        rotulo: null,
        config: null,
        comando: null,
        modelo: null,
        modelo_efetivo: null,
        limite_seguido: null,
        ativo: true,
        cota: { curta: 90, longa: 25, medida_ha_min: 45, limites: [], alerta_curta: true, alerta_longa: false, estado: 'antiga' }
      },
      { nome: 'codex', agente: 'codex', vagas: 1, usadas: 0, peso: 1, papeis: [], ocupantes: [], sessoes: null, agentes: null, cota: { curta: 24, longa: 42, medida_ha_min: 1, limites: [], alerta_curta: false, alerta_longa: false, estado: 'ok' }, origem: 'orca', rotulo: 'eu@exemplo.com', config: null, comando: null, modelo: null, modelo_efetivo: null, limite_seguido: null, ativo: true },
      { nome: 'claude-abcdef12', agente: 'claude', vagas: 1, usadas: 0, peso: 1, papeis: [], ocupantes: [], sessoes: null, agentes: null, cota: null, origem: 'orca', rotulo: 'gerenciada@exemplo.com', config: null, comando: null, modelo: null, modelo_efetivo: null, limite_seguido: null, ativo: false }
    ]
  }
}

/** Conta work sem login, conta com erro do Orca, Orca fora do ar e um teste parado. */
export const estadoComAlertas: Estado = {
  ...estadoExemplo,
  alertas: [
    { codigo: 'sem_login', nivel: 'erro', params: { conta: 'work' }, acao: 'CLAUDE_CONFIG_DIR=~/.claude-work claude auth login' },
    { codigo: 'erro_medida', nivel: 'erro', params: { conta: 'codex', detalhe: 'token expirado' } },
    { codigo: 'orca_indisponivel', nivel: 'erro' },
    { codigo: 'teste_parado', nivel: 'aviso', params: { pid: 99, onde: 'wt-dois' } }
  ],
  saude: { ...estadoExemplo.saude, orca: { rodando: false, versao: null } },
  pool: {
    ...estadoExemplo.pool,
    contas: [
      ...estadoExemplo.pool.contas.slice(0, 1),
      { ...estadoExemplo.pool.contas[1], cota: { curta: null, longa: null, medida_ha_min: null, limites: [], alerta_curta: false, alerta_longa: false, estado: 'erro', erro: 'token expirado' } },
      {
        ...estadoExemplo.pool.contas[0],
        nome: 'work',
        ativo: true,
        cota: { curta: null, longa: null, medida_ha_min: 1400, limites: [], alerta_curta: false, alerta_longa: false, estado: 'sem_login', acao: 'CLAUDE_CONFIG_DIR=~/.claude-work claude auth login' }
      }
    ]
  }
}
