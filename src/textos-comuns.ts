// Textos que o CLI e o painel dizem igual; sem dependência de Node (o painel importa em tempo de execução).
type Mapa = Record<string, string>
type Comuns = {
  /** Códigos de validação da config (`chave: codigo`). */
  codigosConfig: Mapa
  /** Erros de leitura do settings do hook. */
  errosHook: Mapa
  /** Códigos que o worker embute em mensagens além dos de `errosHook`. */
  outrosCodigos: Mapa
  motivosNaoConfigurada: Record<'pasta_ausente' | 'cli_ausente', (valor: string) => string>
  errosMedida: Mapa
  /** Quando a medição falha sem detalhe. */
  medidaFalhou: string
}

const pt: Comuns = {
  codigosConfig: {
    valor_invalido: 'valor inválido',
    config_invalida: 'configuração inválida',
    versao_nao_suportada: 'versão não suportada',
    ilegivel: 'não consegui ler a configuração',
    json_invalido: 'a configuração não é JSON válido',
    conta_existente: 'conta já existe',
    conta_inexistente: 'conta inexistente',
    conta_repetida: 'conta repetida',
    ordem_incompleta: 'ordem incompleta',
    chave_desconhecida: 'chave desconhecida',
    agente_desconhecido: 'agente desconhecido',
    variavel_sem_suporte: 'variável sem suporte',
    agente_nao_provado: 'agente sem hook comprovado',
    config_ocupada: 'outra gravação da configuração em andamento',
  },
  errosHook: {
    raiz_invalida: 'raiz não é um objeto',
    hooks_invalido: '"hooks" inválido',
    pretooluse_invalido: '"hooks.PreToolUse" inválido',
  },
  outrosCodigos: { skill_sem_origem: 'arquivos da skill ausentes no plugin' },
  motivosNaoConfigurada: { pasta_ausente: v => `pasta ${v} não existe`, cli_ausente: v => `${v} não instalado` },
  errosMedida: { claude_usage_unavailable: 'uso indisponível (/usage não respondeu)' },
  medidaFalhou: 'erro na medição',
}

const en: Comuns = {
  codigosConfig: {
    valor_invalido: 'invalid value',
    config_invalida: 'invalid configuration',
    versao_nao_suportada: 'unsupported version',
    ilegivel: 'could not read the configuration',
    json_invalido: 'the configuration is not valid JSON',
    conta_existente: 'account already exists',
    conta_inexistente: 'account does not exist',
    conta_repetida: 'duplicate account',
    ordem_incompleta: 'incomplete order',
    chave_desconhecida: 'unknown key',
    agente_desconhecido: 'unknown agent',
    variavel_sem_suporte: 'unsupported variable',
    agente_nao_provado: 'agent without a proven hook',
    config_ocupada: 'another configuration write is in progress',
  },
  errosHook: {
    raiz_invalida: 'root is not an object',
    hooks_invalido: '"hooks" is invalid',
    pretooluse_invalido: '"hooks.PreToolUse" is invalid',
  },
  outrosCodigos: { skill_sem_origem: 'skill files missing from the plugin' },
  motivosNaoConfigurada: { pasta_ausente: v => `folder ${v} does not exist`, cli_ausente: v => `${v} not installed` },
  errosMedida: { claude_usage_unavailable: 'usage unavailable (/usage did not respond)' },
  medidaFalhou: 'measurement failed',
}

export const textosComuns = { pt, en }

/** Detalhe da medição já traduzido; sem tradução vale o detalhe cru, e sem detalhe a frase genérica. */
export const erroMedida = (c: Comuns, detalhe?: string | null): string => (detalhe && c.errosMedida[detalhe]) || detalhe || c.medidaFalhou
