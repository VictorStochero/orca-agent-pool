import { acharAgente } from '../catalogo.ts'
import type { Conta, Medida } from '../tipos.ts'

// shortcut: nomes de modelo e de grupo vêm dos fornecedores; renomeou → atualizar esta tabela.
const TABELA: readonly [agente: string, modelo: RegExp, limite: string][] = [
  ['claude', /fable/i, 'Fable'],
  ['antigravity', /argon/i, 'Gemini 4 Argon'],
  ['antigravity', /claude|gpt/i, 'Claude and GPT models'],
  ['antigravity', /gemini|flash/i, 'Gemini Models']
]

/** Nome do limite separado que o modelo consome; null = limite geral. */
export function limiteDoModelo(agente: string, modelo: string | null): string | null {
  if (!modelo) return null
  return TABELA.find(([a, re]) => a === agente && re.test(modelo))?.[2] ?? null
}

/** Modelo que o pool manda usar: o da conta, senão o padrão do agente. */
export const modeloEfetivo = (c: Conta): string | null => c.modelo ?? acharAgente(c.agente)?.modeloPadrao ?? null

/** Limite que a conta segue, se a medida o traz. */
export function limiteSeguido(c: Conta, m: Medida | undefined) {
  const nome = limiteDoModelo(c.agente, modeloEfetivo(c))?.toLowerCase()
  return (nome && m?.limites?.find((l) => l.nome.toLowerCase() === nome)) || null
}

/** Medida com curta/longa do limite seguido; janela que ele não tem (ex.: Fable e Argon sem 5h) fica a geral. */
export function medidaEfetiva(c: Conta, m: Medida): Medida {
  const l = limiteSeguido(c, m)
  return l ? { ...m, curta: l.curta ?? m.curta, longa: l.longa ?? m.longa } : m
}
