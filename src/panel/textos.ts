import { env } from 'orca'

const pct = (v: number | null) => (v === null ? '-' : `${v}%`)

export const pt = {
  titulo: 'Pool de agentes e fila de testes',
  atualizar: 'Atualizar',
  salvar: 'Salvar',
  gravando: 'Gravando…',
  salvo: 'Salvo.',
  nadaAlterado: 'Nada alterado.',
  carregando: 'Carregando o estado',
  semDados: 'Sem dados',
  coletorNaoRespondeu: 'O coletor não respondeu.',
  coletorFalhou: (codigo: string) => `Coletor falhou (${codigo})`,
  // Erros do worker por `code`; sem entrada (ex.: config_recusada), vale a mensagem do validador.
  erros: {
    config_vazia: 'Nada para gravar',
    agente_invalido: 'Agente sem suporte a hooks',
    hooks_falhou: 'Não foi possível alterar o hook',
    instalacao_recusada: 'Instalação não permitida',
    instalacao_falhou: 'Falha na instalação'
  } as Record<string, string>,
  // Códigos de validação da config (os mesmos do CLI); o worker manda `chave: codigo`.
  codigosConfig: {
    valor_invalido: 'valor inválido', config_invalida: 'configuração inválida', versao_nao_suportada: 'versão não suportada',
    ilegivel: 'não consegui ler a configuração', json_invalido: 'a configuração não é JSON válido',
    conta_existente: 'conta já existe', conta_inexistente: 'conta inexistente', conta_repetida: 'conta repetida',
    ordem_incompleta: 'ordem incompleta', chave_desconhecida: 'chave desconhecida',
    agente_desconhecido: 'agente desconhecido', variavel_sem_suporte: 'variável sem suporte',
    agente_nao_provado: 'agente sem imposição comprovada', config_ocupada: 'outra gravação da configuração em andamento'
  } as Record<string, string>,
  errosMedida: { claude_usage_unavailable: 'uso indisponível (/usage não respondeu)' } as Record<string, string>,
  // Códigos que o worker embute em mensagens (hook, orca, skill); `orca_saiu:N` leva o código de saída.
  codigosTexto: {
    raiz_invalida: 'raiz não é um objeto', hooks_invalido: '"hooks" inválido', pretooluse_invalido: '"hooks.PreToolUse" inválido',
    skill_sem_origem: 'arquivos da skill ausentes no plugin'
  } as Record<string, string>,
  orcaSaiu: (n: string) => `orca saiu com código ${n}`,
  alertas: {
    config_ilegivel: (detalhe: string) => `config.json ilegível: ${detalhe}`,
    orca_indisponivel: 'Orca indisponível: cota nativa e vagas recuperadas não são atualizadas',
    sem_login: (conta: string) => `${conta}: sem login`,
    erro_medida: (conta: string, detalhe?: string) => `${conta}: ${(detalhe && pt.errosMedida[detalhe]) || detalhe || 'erro na medição'}`,
    teste_parado: (pid: number | null, onde: string) => `Teste parado (pid ${pid ?? '?'}) em ${onde}`
  },
  atualizadoEm: 'Atualizado',
  plugin: 'Plugin',
  orca: 'Orca',
  orcaRodando: 'rodando',
  orcaForaDoAr: 'fora do ar',
  requisitos: {
    titulo: 'Requisitos',
    explica: 'O painel só funciona com todos os requisitos abaixo instalados.',
    tabela: 'Requisitos do painel',
    colRequisito: 'Requisito',
    colSituacao: 'Situação',
    ok: '✓ ok',
    falta: '✗ falta',
    instalar: 'Instalar',
    instalando: 'Instalando…',
    nomes: { orca: 'Orca', orchestration: 'Skill orchestration', skill: 'Skill agent-pool', lancador: 'Lançador agent-pool', hooks: 'Hooks de imposição' },
    detalhe: {
      nao_verificado: (v: string) => `não verificado: ${v}`,
      versao: (v: string) => `versão ${v}`,
      versao_antiga: (v: string) => `versão ${v}; atualize o Orca`,
      instalada: 'instalada',
      instalada_editada: 'instalada (editada por você)',
      nao_instalada: 'não instalada',
      desatualizada: 'desatualizada',
      sem_origem: 'arquivos da skill ausentes no plugin',
      instalado: 'instalado',
      nao_instalado: 'não instalado',
      hooks_nenhum: 'nenhum agente com hook detectado',
      situacoes: { instalado: 'instalado', ausente: 'ausente', erro: 'erro', removido: 'removido por você' } as Record<string, string>
    }
  },
  dicaLinha: 'Clique numa linha para ver os detalhes.',
  configuracoes: {
    titulo: 'Configurações',
    descricao: 'Fila, pool, contas, imposição e painel',
    assuntos: 'Assuntos das configurações',
    abas: { fila: 'Fila', pool: 'Pool', contas: 'Contas', imposicao: 'Imposição', painel: 'Painel' },
    contasAbas: { assuntos: 'Assuntos das contas', configurar: 'Configurar', cadastrar: 'Cadastrar' },
    linhas: {
      fila: 'Como os testes esperam a vez — ~/.agents/agent-pool/config.json',
      pool: 'Limites da máquina e como o escritor é escolhido — ~/.agents/agent-pool/config.json',
      contas:
        'Vagas, peso, papéis e ordem de cada conta — ~/.agents/agent-pool/config.json. As contas detectadas pelo Orca entram no pool sozinhas; as manuais são CLIs personalizados, cadastrados em "Nova conta manual".',
      painel: 'Este painel — guardado no Orca'
    }
  },
  painel: {
    intervalo: 'Atualizar a cada (segundos)',
    dica: 'Coleta local feita pelo worker, sem IA e sem gastar tokens; valores baixos só aumentam o uso de CPU.',
    invalido: (min: number, max: number) => `Informe um número inteiro de ${min} a ${max}.`
  },

  fila: {
    titulo: 'Testes na fila',
    explica: 'Os testes esperam a vez numa fila para a máquina não sobrecarregar: cada fila libera um número de vagas e o teto limita o total de testes ao mesmo tempo.',
    modos: { global: 'Global', banco: 'Por banco', projeto: 'Por projeto' } as Record<string, string>,
    resumo: (execucao: number, aguardando: number, teto: number, modo: string) =>
      `${execucao} em execução · ${aguardando} aguardando · teto ${teto} · Modo ${modo}`,
    comoFunciona: 'Como funciona a fila',
    semTestes: 'Nenhum teste na fila',
    tabela: 'Testes na fila',
    colProjeto: 'Projeto',
    colFila: 'Fila',
    colEstado: 'Estado',
    colHa: 'Há',
    filaGlobal: 'Global',
    filaProjeto: (nome: string) => `Projeto ${nome}`,
    filaBanco: (endereco: string) => `Banco ${endereco}`,
    filaContainer: 'Container',
    filaGeral: 'Geral',
    estados: { execucao: 'Em execução', aguardando: 'Aguardando vaga', parado: '⚠ Parado' } as Record<string, string>,
    dicaParado: 'O processo terminou e deixou a vaga presa.',
    ondeRoda: 'Onde roda',
    comando: 'Comando',
    pid: 'PID',
    worktree: 'Worktree',
    situacao: 'Situação',
    configurarDescricao: 'vale só para testes iniciados depois',
    campos: {
      modo: 'Modo da fila',
      vagas: 'Vagas',
      vagas_projeto: 'Vagas por projeto',
      teto: 'Teto da máquina',
      processos: 'Processos (--parallel)'
    },
    dicas: {
      global: 'Uma fila única para a máquina inteira: todos os testes, de qualquer projeto, esperam a mesma vez.',
      banco:
        'Uma fila por banco (endereço:porta/banco), compartilhada entre projetos, com 1 teste por vez em cada banco: testes que usam o mesmo banco esperam uns pelos outros; container e Python/JS têm filas próprias. Use quando os projetos dividem o banco de testes.',
      projeto:
        'Cada projeto tem a própria fila (vagas por projeto), independente dos outros; só o teto da máquina limita o total. Use quando cada projeto tem banco de testes próprio.',
      vagas: 'Testes ao mesmo tempo em cada fila. No modo Por banco, cada banco tem 1 vaga e esta vale para as filas sem banco (container, Python/JS).',
      vagas_projeto: 'Testes ao mesmo tempo em cada projeto. Só vale no modo Por projeto.',
      teto: 'Máximo de testes ao mesmo tempo na máquina, somando todas as filas.'
    }
  },

  atencao: 'Atenção',
  pool: {
    titulo: 'Pool de agentes',
    resumo: (usadas: number, teto: number, ramMin: number, escolha: string) =>
      `Agentes ${usadas}/${teto || '∞'} · RAM mínima ${ramMin} GB · Escritor ${escolha === 'ordem' ? 'pela ordem da tabela' : 'pelo ritmo da cota'}`,
    escolhaOpcoes: { ritmo: 'Ritmo da cota', ordem: 'Ordem da tabela' } as Record<string, string>,
    semContas: 'Nenhuma conta no registro.',
    tabela: 'Contas do pool',
    colConta: 'Conta',
    colVagas: 'Vagas',
    col5h: '5h',
    colSemanal: 'Semanal',
    percentual: (v: number | null, alerta: boolean) => `${alerta ? '⚠ ' : ''}${pct(v)}`,
    janelasValor: (curta: number | null, longa: number | null) => `5h ${pct(curta)} · semana ${pct(longa)}`,
    semLogin: 'sem login',
    erroMedida: (detalhe?: string | null) => (detalhe && pt.errosMedida[detalhe]) || detalhe || 'erro na medição',
    vagasDaConta: (usadas: number, vagas: number) => `${usadas}/${vagas || '∞'}`,
    naoUtilizada: 'não utilizada',
    situacao: 'Situação',
    naoUtilizadaDetalhe: 'Não utilizada: continua listada e medida, mas não recebe trabalho nem conta no teto.',
    agente: 'Agente',
    peso: 'Peso',
    pesoDaConta: 'Peso da conta',
    papeis: 'Papéis',
    janelas: 'Zera',
    semMedida: 'sem medida',
    aviso: 'Aviso',
    medidaHa: 'Medida há',
    semLeitura: '—',
    problema: 'Problema',
    acao: 'Para resolver',
    medidaAntiga: (min: number) => `Medida antiga: há ${min} min. Rode agent-pool measure antes de confiar nesta cota.`,
    minutos: (n: number) => `${n} min`,
    vagasEmUso: 'Vagas em uso',
    nenhuma: 'nenhuma',
    vagas: 'Vagas da conta',
    teto: 'Teto da máquina (0 = sem teto)',
    ramMin: 'RAM mínima livre (GB)',
    escolha: 'Escolha do escritor',
    rotulo: 'Conta no Orca',
    naoUtilizar: 'Não utilizar',
    remover: 'Remover do pool',
    confirmarRemocao: (nome: string) => `Remover ${nome} da configuração?`,
    confirmar: 'Confirmar remoção',
    cancelar: 'Cancelar',
    config: 'Diretório de config (CLAUDE_CONFIG_DIR etc.)',
    comandoCli: 'Comando do CLI',
    comandoDaConta: 'Comando do CLI da conta',
    novaConfig: 'Diretório de config',
    dicas: {
      naoUtilizar: 'A conta continua listada e medida, mas não recebe trabalho nem conta no teto. Desmarque para voltar a usar.',
      novoComando: 'Comando que abre o CLI desta conta, por exemplo claude-work ou CLAUDE_CONFIG_DIR=~/.claude-work claude. Informe o comando, o diretório de config ou os dois.',
      novoConfig: 'Pasta de configuração do CLI, por exemplo ~/.claude-work. Informe o diretório de config, o comando ou os dois.',
      vagas: 'Quantos agentes desta conta podem trabalhar ao mesmo tempo. 0 = sem limite próprio (o teto da máquina continua valendo).',
      peso: 'Prioridade na escolha do escritor: multiplica o ritmo da cota. Peso 10 é escolhido bem antes de peso 1 com a mesma folga. Ignorado quando a escolha é Ordem.',
      config: 'Pasta de configuração do agente (por exemplo CLAUDE_CONFIG_DIR) que separa esta conta das outras do mesmo agente. Vazio = a conta padrão do sistema.',
      teto: 'Máximo de agentes trabalhando ao mesmo tempo na máquina, somando todas as contas. 0 = sem limite.',
      ramMin: 'Memória livre mínima (GB) para reservar uma vaga nova. 0 = desligado.',
      escolha: 'Ritmo da cota: o escritor é a conta com mais cota sobrando × peso. Ordem da tabela: a primeira conta da tabela do Pool com vaga e cota abaixo do teto.'
    },
    // Do maior para o menor nível de responsabilidade; papel fora da lista vai para o fim.
    ordemPapeis: ['orquestra', 'revisor', 'verificador', 'escritor', 'segunda-opiniao', 'mecanico'],
    nomesPapel: {
      orquestra: 'Orquestra',
      revisor: 'Revisor',
      verificador: 'Verificador',
      escritor: 'Escritor',
      'segunda-opiniao': 'Segunda opinião',
      mecanico: 'Mecânico'
    } as Record<string, string>,
    dicasPapel: {
      escritor: 'Implementa a tarefa: código, testes e commit no worktree.',
      revisor: 'Gate de merge só leitura: revisa comportamento e arquitetura antes de subir.',
      verificador: 'Contraprova só leitura: tenta refutar os achados de uma revisão ou um diagnóstico.',
      mecanico: 'Tarefas mecânicas e conferíveis (fixtures, edição literal, mover por mapa) com modelo menor.',
      'segunda-opiniao': 'Revisão adversarial de outra família de modelo, só leitura, em entregas de alto risco.',
      orquestra: 'Coordena os workers; conta só com este papel nunca é escolhida para trabalho.'
    } as Record<string, string>,
    escolherConta: 'Conta a configurar',
    ordemNaTabela: 'Posição na tabela do Pool (usada quando o escritor é escolhido pela ordem da tabela)',
    subir: 'Subir',
    descer: 'Descer',
    nova: 'Nova conta manual',
    novaNome: 'Nome',
    novaCriar: 'Adicionar conta'
  },
  imposicao: {
    titulo: 'Imposição',
    descricao: 'Hooks orientam os agentes a usar a fila de testes.',
    estados: { instalado: 'Instalado', ausente: 'Ausente', erro: 'Erro' },
    remover: 'Remover imposição',
    reinstalar: 'Reinstalar',
    indisponivel: 'Não foi possível ler a imposição.'
  }
}

export const en: typeof pt = {
  titulo: 'Agent Pool & Test Queue', atualizar: 'Refresh', salvar: 'Save', gravando: 'Saving…', salvo: 'Saved.',
  nadaAlterado: 'No changes.', carregando: 'Loading status', semDados: 'No data',
  coletorNaoRespondeu: 'The worker did not respond.', coletorFalhou: (codigo) => `Worker failed (${codigo})`,
  erros: {
    config_vazia: 'Nothing to save', agente_invalido: 'Agent without hook support', hooks_falhou: 'Could not change the hook',
    instalacao_recusada: 'Install not allowed', instalacao_falhou: 'Installation failed'
  },
  codigosConfig: {
    valor_invalido: 'invalid value', config_invalida: 'invalid configuration', versao_nao_suportada: 'unsupported version',
    ilegivel: 'could not read the configuration', json_invalido: 'the configuration is not valid JSON',
    conta_existente: 'account already exists', conta_inexistente: 'account does not exist', conta_repetida: 'duplicate account',
    ordem_incompleta: 'incomplete order', chave_desconhecida: 'unknown key',
    agente_desconhecido: 'unknown agent', variavel_sem_suporte: 'unsupported variable',
    agente_nao_provado: 'agent without proven enforcement', config_ocupada: 'another configuration write is in progress'
  },
  errosMedida: { claude_usage_unavailable: 'usage unavailable (/usage did not respond)' },
  codigosTexto: {
    raiz_invalida: 'root is not an object', hooks_invalido: '"hooks" is invalid', pretooluse_invalido: '"hooks.PreToolUse" is invalid',
    skill_sem_origem: 'skill files missing from the plugin'
  },
  orcaSaiu: (n) => `orca exited with code ${n}`,
  alertas: {
    config_ilegivel: (detalhe) => `config.json unreadable: ${detalhe}`,
    orca_indisponivel: 'Orca unavailable: native quota and slot recovery are not updated',
    sem_login: (conta) => `${conta}: not signed in`,
    erro_medida: (conta, detalhe) => `${conta}: ${(detalhe && en.errosMedida[detalhe]) || detalhe || 'measurement failed'}`,
    teste_parado: (pid, onde) => `Stopped test (pid ${pid ?? '?'}) in ${onde}`
  },
  atualizadoEm: 'Updated', plugin: 'Plugin', orca: 'Orca',
  orcaRodando: 'running', orcaForaDoAr: 'unavailable',
  requisitos: {
    titulo: 'Requirements', explica: 'Install all requirements below to use the panel.', tabela: 'Panel requirements',
    colRequisito: 'Requirement', colSituacao: 'Status', ok: '✓ ready', falta: '✗ missing',
    instalar: 'Install', instalando: 'Installing…',
    nomes: { orca: 'Orca', orchestration: 'Orchestration skill', skill: 'agent-pool skill', lancador: 'agent-pool launcher', hooks: 'Enforcement hooks' },
    detalhe: {
      nao_verificado: (v) => `not verified: ${v}`, versao: (v) => `version ${v}`, versao_antiga: (v) => `version ${v}; update Orca`,
      instalada: 'installed', instalada_editada: 'installed (edited by you)', nao_instalada: 'not installed', desatualizada: 'outdated',
      sem_origem: 'skill files missing from the plugin', instalado: 'installed', nao_instalado: 'not installed', hooks_nenhum: 'no agent with hooks detected',
      situacoes: { instalado: 'installed', ausente: 'missing', erro: 'error', removido: 'removed by you' }
    }
  },
  dicaLinha: 'Click a row to see details.',
  configuracoes: {
    titulo: 'Settings', descricao: 'Queue, pool, accounts, enforcement and panel', assuntos: 'Settings sections',
    abas: { fila: 'Queue', pool: 'Pool', contas: 'Accounts', imposicao: 'Enforcement', painel: 'Panel' },
    contasAbas: { assuntos: 'Account sections', configurar: 'Configure', cadastrar: 'Add' },
    linhas: {
      fila: 'How tests wait for a slot — ~/.agents/agent-pool/config.json',
      pool: 'Machine limits and writer selection — ~/.agents/agent-pool/config.json',
      contas: 'Slots, weight, roles and account order — ~/.agents/agent-pool/config.json. Orca accounts join automatically; add custom CLIs under "New manual account".',
      painel: 'This panel — stored in Orca'
    }
  },
  painel: {
    intervalo: 'Refresh every (seconds)', dica: 'The worker collects local data without AI or tokens; shorter intervals increase CPU usage.',
    invalido: (min, max) => `Enter a whole number from ${min} to ${max}.`
  },
  fila: {
    titulo: 'Queued tests', explica: 'Tests wait in queues to avoid overloading the machine. Each queue has slots, and the machine cap limits concurrent tests across all queues.',
    modos: { global: 'Global', banco: 'Per database', projeto: 'Per project' },
    resumo: (execucao, aguardando, teto, modo) => `${execucao} running · ${aguardando} waiting · cap ${teto} · Mode ${modo}`,
    comoFunciona: 'How the queue works', semTestes: 'No queued tests', tabela: 'Queued tests',
    colProjeto: 'Project', colFila: 'Queue', colEstado: 'Status', colHa: 'Since', filaGlobal: 'Global',
    filaProjeto: (nome) => `Project ${nome}`, filaBanco: (endereco) => `Database ${endereco}`,
    filaContainer: 'Container', filaGeral: 'General',
    estados: { execucao: 'Running', aguardando: 'Waiting for a slot', parado: '⚠ Stopped' },
    dicaParado: 'The process ended and left a slot locked.', ondeRoda: 'Runs on', comando: 'Command', pid: 'PID', worktree: 'Worktree',
    situacao: 'Status', configurarDescricao: 'applies to tests started afterwards',
    campos: { modo: 'Queue mode', vagas: 'Slots', vagas_projeto: 'Slots per project', teto: 'Machine cap', processos: 'Processes (--parallel)' },
    dicas: {
      global: 'One queue for the whole machine: tests from every project wait for the same slots.',
      banco: 'One queue per database (address:port/database), shared by projects, with 1 test at a time per database. Use when projects share a test database. Containers and tests without a database have their own queues.',
      projeto: 'Each project has its own queue and slots. Only the machine cap limits the total. Use when each project has its own test database.',
      vagas: 'Concurrent tests in each queue. In Per database mode each database gets 1 slot and this applies to the queues without a database (container, Python/JS).', vagas_projeto: 'Concurrent tests in each project. Only applies in Per project mode.',
      teto: 'Maximum concurrent tests on the machine across all queues.'
    }
  },
  atencao: 'Attention',
  pool: {
    titulo: 'Agent pool', resumo: (usadas, teto, ramMin, escolha) => `Agents ${usadas}/${teto || '∞'} · Minimum RAM ${ramMin} GB · Writer ${escolha === 'ordem' ? 'by table order' : 'by quota pace'}`,
    escolhaOpcoes: { ritmo: 'Quota pace', ordem: 'Table order' }, semContas: 'No registered accounts.', tabela: 'Pool accounts',
    colConta: 'Account', colVagas: 'Slots', col5h: '5h', colSemanal: 'Weekly',
    percentual: (v, alerta) => `${alerta ? '⚠ ' : ''}${pct(v)}`,
    janelasValor: (curta, longa) => `5h ${pct(curta)} · week ${pct(longa)}`, semLogin: 'not signed in', erroMedida: (detalhe) => (detalhe && en.errosMedida[detalhe]) || detalhe || 'measurement failed',
    vagasDaConta: (usadas, vagas) => `${usadas}/${vagas || '∞'}`,
    naoUtilizada: 'not used', situacao: 'Status', naoUtilizadaDetalhe: 'Not used: still listed and measured, but receives no work and does not count towards the cap.',
    agente: 'Agent', peso: 'Weight', pesoDaConta: 'Account weight', papeis: 'Roles', janelas: 'Resets', semMedida: 'no measurement',
    aviso: 'Notice', medidaHa: 'Measured', semLeitura: '—', problema: 'Problem', acao: 'To resolve',
    medidaAntiga: (min) => `Old measurement: ${min} min ago. Run agent-pool measure before relying on this quota.`,
    minutos: (n) => `${n} min`, vagasEmUso: 'Slots in use', nenhuma: 'none', vagas: 'Account slots',
    teto: 'Machine cap (0 = unlimited)', ramMin: 'Minimum free RAM (GB)', escolha: 'Writer selection', rotulo: 'Orca account',
    naoUtilizar: 'Do not use', remover: 'Remove from pool',
    confirmarRemocao: (nome) => `Remove ${nome} from the configuration?`, confirmar: 'Confirm removal', cancelar: 'Cancel',
    config: 'Config directory (CLAUDE_CONFIG_DIR etc.)', comandoCli: 'CLI command', comandoDaConta: 'Account CLI command', novaConfig: 'Config directory',
    dicas: {
      naoUtilizar: 'The account stays listed and measured, but receives no work and does not count towards the cap. Uncheck to use it again.',
      novoComando: 'Command to open this account, for example claude-work or CLAUDE_CONFIG_DIR=~/.claude-work claude. Provide a command, a config directory, or both.',
      novoConfig: 'CLI configuration folder, for example ~/.claude-work. Provide a config directory, a command, or both.',
      vagas: 'Concurrent agents for this account. 0 = no account limit (the machine cap still applies).',
      peso: 'Writer priority: multiplies quota pace. With equal quota, weight 10 is preferred over weight 1. Ignored in Table order mode.',
      config: 'Agent configuration folder (such as CLAUDE_CONFIG_DIR) that separates accounts. Empty = system default account.',
      teto: 'Maximum concurrent agents across all accounts. 0 = unlimited.',
      ramMin: 'Minimum free memory (GB) to reserve a slot. 0 = disabled.',
      escolha: 'Quota pace: the account with the most free quota × weight. Table order: the first eligible account with a free slot and quota below the limit.'
    },
    ordemPapeis: ['orquestra', 'revisor', 'verificador', 'escritor', 'segunda-opiniao', 'mecanico'],
    nomesPapel: { orquestra: 'Coordinator', revisor: 'Reviewer', verificador: 'Verifier', escritor: 'Writer', 'segunda-opiniao': 'Second opinion', mecanico: 'Mechanic' },
    dicasPapel: {
      escritor: 'Implements the task: code, tests and a local worktree commit.', revisor: 'Reviews behavior and architecture before merge and publication.',
      verificador: 'Read-only cross-check of review findings or a diagnosis.', mecanico: 'Mechanical, verifiable tasks such as fixtures or literal edits.',
      'segunda-opiniao': 'Read-only adversarial review from a different model family for high-risk changes.',
      orquestra: 'Coordinates workers. An account with only this role is never selected for work.'
    },
    escolherConta: 'Account to configure', ordemNaTabela: 'Pool table position (used when selecting writers by table order)',
    subir: 'Move up', descer: 'Move down', nova: 'New manual account', novaNome: 'Name', novaCriar: 'Add account'
  },
  imposicao: {
    titulo: 'Enforcement', descricao: 'Hooks guide agents to use the test queue.',
    estados: { instalado: 'Installed', ausente: 'Not installed', erro: 'Error' }, remover: 'Remove enforcement', reinstalar: 'Reinstall',
    indisponivel: 'Could not read enforcement status.'
  }
}

export const textos = { en, pt }
export const textosPara = (locale = 'en'): typeof pt => locale.toLowerCase().startsWith('pt') ? pt : en
export const t: typeof pt = new Proxy(en, { get: (_alvo, chave: keyof typeof pt) => textosPara(env.locale)[chave] })
