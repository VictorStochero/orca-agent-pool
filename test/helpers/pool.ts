import type { Config, Conta } from '../../src/core/tipos.ts'

export function conta(nome: string, extra: Partial<Conta> = {}): Conta {
  return {
    nome, agente: 'claude', config: null, comando: null, modelo: null, vagas: 2, peso: 1,
    papeis: ['escritor', 'revisor', 'segunda-opiniao'], ativo: true, origem: 'manual', ...extra
  }
}

export function cfg(contas: Conta[], pool: Partial<Config['pool']> = {}): Config {
  return {
    versao: 1,
    pool: { teto: 0, ramMinGb: 0, escolha: 'ritmo', contas, ...pool },
    fila: { modo: 'banco', vagas: 2, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 300 }
  }
}
