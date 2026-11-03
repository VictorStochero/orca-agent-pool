// Contrato painel <-> worker, declarado uma vez: src/panel/* e src/worker/* leem este arquivo.
export {}

/** Um teste na fila; a trava do teto não entra. Ordem do backend: execução, aguardando, parado (do mais antigo ao mais novo). */
export type TesteFila = {
  pid: number | null
  estado: 'execucao' | 'aguardando' | 'parado'
  /** `mysql 127.0.0.1:3307`, `container <executor>`, `geral`, `global` ou `projeto <nome>`. */
  recurso: string | null
  worktree: string | null
  /** Último segmento do worktree. */
  projeto: string | null
  comando: string | null
  /** Chave da fila real da trava ou da espera (`global`, `proj-<x>`, `_teto`, banco…); null se o registro não a traz. */
  fila: string | null
  /** Epoch em ms: início da trava (execução, parado) ou da espera (aguardando). */
  desde_ts: number | null
}

/** Cota da conta: 5h = janela curta, Semanal = janela longa (percentuais de 0 a 100). */
export type Cota = {
  curta: number | null
  longa: number | null
  /** null quando não há medida. */
  medida_ha_min: number | null
  /** Janela no limite de alerta: a regra fica só no worker. */
  alerta_curta: boolean
  alerta_longa: boolean
  /** Limites separados (ex.: Fable, grupos do antigravity); vazio quando não há. */
  limites: { nome: string; curta: number | null; longa: number | null }[]
  /** `sem_login` e `erro` pedem ação do usuário; `antiga` = medida com mais de 30 min; `sem_medida` = nada lido. */
  estado: 'ok' | 'sem_login' | 'erro' | 'antiga' | 'sem_medida' | 'nao_configurada'
  /** Comando que resolve (`sem_login`), quando houver. */
  acao?: string | null
  /** Detalhe técnico do medidor quando `estado` é `erro`; o painel monta a frase. */
  erro?: string | null
  /** Por que a conta está `nao_configurada` (pasta ou CLI ausente), já separado; o painel monta a frase. */
  motivo?: { tipo: 'pasta_ausente' | 'cli_ausente'; valor: string } | null
}

export type Ocupante = { dispatch: string | null; desde: string | null }

export type Conta = {
  nome: string
  agente: string | null
  vagas: number
  usadas: number
  peso: number
  papeis: string[]
  ocupantes: Ocupante[]
  /** Nomes das sessões interativas abertas (só exibição, fora das vagas); null = conta sem leitura de sessões. */
  sessoes: string[] | null
  cota: Cota | null
  /** `orca`: entrou sozinha pela detecção; `manual`: cadastrada pelo usuário (CLI personalizado). */
  origem: 'manual' | 'orca'
  rotulo: string | null
  config: string | null
  /** Comando personalizado da conta manual. */
  comando: string | null
  /** Modelo gravado na conta; null = padrão do agente. */
  modelo: string | null
  /** Modelo que o pool manda usar (o da conta ou o padrão do agente); null = nenhum. */
  modelo_efetivo: string | null
  /** Nome do limite separado que o modelo consome; null = limite geral. */
  limite_seguido: string | null
  /** false = "Não utilizar": listada e medida, mas fora do trabalho e do teto. */
  ativo: boolean
}

export type ItemFila = 'modo' | 'vagas' | 'vagas_projeto' | 'teto' | 'processos'

/** Problema que o usuário precisa resolver: o worker manda código e dados, o painel monta a frase no idioma; `acao` é o comando para copiar. */
export type Alerta = {
  codigo: 'config_ilegivel' | 'orca_indisponivel' | 'sem_login' | 'erro_medida' | 'teste_parado'
  nivel: 'erro' | 'aviso'
  /** `config_ilegivel`: detalhe; `sem_login`/`erro_medida`: conta (+ detalhe); `teste_parado`: pid e onde. */
  params?: { conta?: string; detalhe?: string; pid?: number | null; onde?: string }
  acao?: string
}

/** Estado da máquina montado pelo worker a partir do núcleo. */
export type Estado = {
  gerado_em: string
  alertas: Alerta[]
  saude: { plugin_versao: string | null; orca: { rodando: boolean | null; versao: string | null } }
  fila: { modo: 'global' | 'banco' | 'projeto'; vagas: number; teto: number; testes: TesteFila[]; config: Record<ItemFila, string | number> }
  pool: {
    teto: number
    ram_min: number
    escolha: string
    papeis_validos: string[]
    maquina: { usadas: number; teto: number }
    /** Total de sessões abertas da máquina (uma vez por pasta de configuração). */
    sessoes: number
    contas: Conta[]
  }
}

/** Erros do worker trazem `code` estável (`config_recusada`, `config_vazia`, `agente_invalido`, `hooks_falhou`, `instalacao_recusada`, `instalacao_falhou`) e o painel os traduz; `message` é só o dado (agente, id, detalhe técnico). */
export type IdRequisito = 'orca' | 'orchestration' | 'skill' | 'lancador' | 'hooks'

/** Situação de um requisito, em código e dados; o painel monta a frase no idioma. */
export type DetalheRequisito =
  | { codigo: 'nao_verificado' | 'versao' | 'versao_antiga'; valor: string }
  | { codigo: 'instalada' | 'instalada_editada' | 'nao_instalada' | 'desatualizada' | 'sem_origem' | 'nao_instalado' | 'hooks_nenhum' }
  /** `valor`: caminho do lançador instalado. */
  | { codigo: 'instalado'; valor?: string }
  | { codigo: 'hooks'; agentes: { agente: string; situacao: 'instalado' | 'ausente' | 'erro' | 'removido'; erro?: string }[] }

/** `instalar`: o painel mostra o botão e executa por `requisitos.instalar`. */
export type RequisitoItem = {
  id: IdRequisito
  ok: boolean
  detalhe: DetalheRequisito
  instalar?: true
}

export type Requisitos = { ok: boolean; itens: RequisitoItem[] }

/** Estado dos hooks por agente; `detalhe` traz o erro quando `estado` é `erro`. */
export type EstadoHookAgente = { agente: string; estado: 'instalado' | 'ausente' | 'erro'; detalhe?: string }

declare module 'orca' {
  interface PluginRequests {
    /** Orca ≥ 1.4.246, skill orchestration, skill agent-pool, lançador e hooks; guardado por 60 s, a menos que `forcar`. */
    'requisitos.ler': { input: { forcar?: boolean } | undefined; output: Requisitos }
    /** `orchestration`, `skill`, `lancador` ou `hooks`; devolve `requisitos.ler` novo. Outro id: erro `instalacao_recusada`. */
    'requisitos.instalar': { input: { id: 'orchestration' | 'skill' | 'lancador' | 'hooks' }; output: Requisitos }
    /** Estado da máquina lido do núcleo (a cota vem da última medição do ciclo; ler nunca mede). */
    'estado.ler': { output: Estado }
    /**
     * Grava no config.json pelas chaves de `agent-pool config set` (tudo ou nada) e devolve o estado novo.
     * Recusa do validador ou config ilegível: erro `config_recusada`.
     */
    'config.gravar': { input: { valores: Record<string, string> }; output: Estado }
    /** Ciclo de atualização enquanto o painel está aberto; resolve ao fechar ou a cada renovação. */
    'auto.assistir': { output: true }
    /** Hooks: um item por agente com hook (claude, codex). */
    'hooks.estado': { output: EstadoHookAgente[] }
    /** Remove só o nosso hook do agente; devolve a lista atualizada. Agente desconhecido: erro `agente_invalido`. */
    'hooks.remover': { input: { agente: string }; output: EstadoHookAgente[] }
    /** Reinstala o hook do agente (com backup); devolve a lista atualizada. */
    'hooks.reinstalar': { input: { agente: string }; output: EstadoHookAgente[] }
  }
  interface PluginPanelEvents {
    /** Fila, pool ou config mudaram em disco; o painel pede o estado de novo. */
    'estado.mudou': { em: number }
  }
}
