// Tipos compartilhados do núcleo.
export type Papel = 'orquestra' | 'revisor' | 'verificador' | 'escritor' | 'segunda-opiniao' | 'mecanico'

export type Conta = {
  nome: string
  agente: string
  config: string | null
  comando: string | null
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
}

export type Config = {
  versao: 1
  pool: { teto: number; ramMinGb: number; escolha: 'ritmo' | 'ordem'; contas: Conta[]; /** Contas detectadas que o usuário removeu: a detecção não as readiciona. */ ignoradas?: string[] }
  fila: ConfigFila
}

export type Limite = { nome: string; curta: number | null; longa: number | null }

export type Medida = {
  conta: string
  curta: number | null
  longa: number | null
  resetLongaTs: number | null
  estado: 'ok' | 'sem_login' | 'erro' | 'sem_medida'
  /** Limites separados da conta (ex.: Fable, grupos do antigravity); ausente quando não há. */
  limites?: Limite[]
  acao?: string
  erro?: string
  medidaTs: number
}

export type ResultadoOrca = { code: number; stdout: string; stderr: string }

export type OrcaCli = { run(args: string[], opts?: { timeoutMs?: number }): Promise<ResultadoOrca> }
