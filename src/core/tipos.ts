// Tipos compartilhados do núcleo.
/** Na ordem em que a tela lista. */
export const PAPEIS = ['escritor', 'revisor', 'verificador', 'mecanico', 'segunda-opiniao', 'orquestra'] as const
export type Papel = (typeof PAPEIS)[number]

export type Conta = {
  nome: string
  agente: string
  config: string | null
  comando: string | null
  /** `--model` que o pool manda usar; null = padrão do agente. */
  modelo: string | null
  vagas: number
  peso: number
  papeis: Papel[]
  ativo: boolean
  origem: 'orca' | 'manual'
}

export type ConfigFila = {
  modo: 'global' | 'banco' | 'projeto'
  vagas: number
  vagasPorProjeto: number
  teto: number
  processos: number
  esperaMaxS: number
  /** Minutos sem saída do teste em execução até o aviso `teste_sem_saida`; 0 desliga. */
  semSaidaMin?: number
  /** Apaga os bancos `<base>_test_N` depois de `artisan test --parallel`; ausente = desligado, até o usuário ligar. */
  limparBancos?: boolean
}

export type Config = {
  versao: 1
  pool: {
    teto: number
    ramMinGb: number
    escolha: 'ritmo' | 'ordem'
    contas: Conta[]
    /** Contas detectadas que o usuário removeu: a detecção não as readiciona. */
    ignoradas?: string[]
  }
  fila: ConfigFila
}

export type Limite = { nome: string; curta: number | null; longa: number | null }

export type Medida = {
  conta: string
  curta: number | null
  longa: number | null
  resetLongaTs: number | null
  /** `nao_configurada`: pasta da conta ou CLI ausente nesta máquina; `erro` traz `pasta_ausente:<caminho>` ou `cli_ausente:<executável>`. */
  estado: 'ok' | 'sem_login' | 'erro' | 'sem_medida' | 'nao_configurada'
  /** Limites separados da conta (ex.: Fable, grupos do antigravity); ausente quando não há. */
  limites?: Limite[]
  acao?: string
  erro?: string
  medidaTs: number
}

export type ResultadoOrca = { code: number; stdout: string; stderr: string }

export type OrcaCli = { run(args: string[], opts?: { timeoutMs?: number }): Promise<ResultadoOrca> }
