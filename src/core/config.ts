import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { gravarAtomico } from './atomico.ts'
import { acharAgente, PAPEIS_TRABALHO } from './catalogo.ts'
import type { Paths } from './paths.ts'
import { type Config, PAPEIS } from './tipos.ts'
import { comTrava, TravaOcupada } from './trava.ts'

export type ErroValidacao = { chave: string; codigo: string }

export class ErroConfig extends Error {
  erros: ErroValidacao[]
  constructor(erros: ErroValidacao[], mensagem?: string) {
    super(mensagem ?? erros.map(e => `${e.chave}: ${e.codigo}`).join('; '))
    this.name = 'ErroConfig'
    this.erros = erros
  }
}

export const PADRAO: Config = {
  versao: 1,
  pool: { teto: 0, ramMinGb: 0, escolha: 'ritmo', contas: [] },
  fila: { modo: 'banco', vagas: 2, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 300, semSaidaMin: 5, limparBancos: false },
}

export const NOME = /^[a-z0-9_-]{1,32}$/
// Começa com letra ou número: o valor vai como `--model <id>` e não pode virar outra opção (ex.: `--help`).
const MODELO = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/
export const FILA_INT: Record<string, [keyof Config['fila'], number, number]> = {
  'fila.vagas': ['vagas', 1, 99],
  'fila.vagas_projeto': ['vagasPorProjeto', 1, 99],
  'fila.teto': ['teto', 1, 99],
  'fila.processos': ['processos', 1, 64],
  'fila.espera_max_s': ['esperaMaxS', 1, 86400],
  'fila.sem_saida_min': ['semSaidaMin', 0, 1440],
}
const CARACTERES_CONTA = {
  config: /^[~A-Za-z0-9_./:\\@+-]+$/,
  comando: /^[~A-Za-z0-9_./:\\@+= -]+$/,
}

/**
 * O valor de config/comando que entra numa conta (CLI, painel, legado) só tem caracteres de caminho/comando simples.
 * Fica fora de `validar`: dado já gravado (ex.: caminho com acento) nunca é recusado ao carregar.
 */
export const caracteresValidos = (campo: 'config' | 'comando', v: string): boolean => v === '' || CARACTERES_CONTA[campo].test(v)

export const recusa = (chave: string, codigo: string): never => {
  throw new ErroConfig([{ chave, codigo }])
}

const naFaixa = (v: unknown, min: number, max: number, inteiro = true): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!inteiro || Number.isInteger(v))

export function validar(c: Config): ErroValidacao[] {
  const erros: ErroValidacao[] = []
  const ruim = (chave: string, codigo = 'valor_invalido') => erros.push({ chave, codigo })
  if (c.versao !== 1) ruim('versao', 'versao_nao_suportada')
  if (!naFaixa(c.pool.teto, 0, 99)) ruim('pool.teto')
  if (!naFaixa(c.pool.ramMinGb, 0, 1024, false)) ruim('pool.ram_min')
  if (c.pool.escolha !== 'ritmo' && c.pool.escolha !== 'ordem') ruim('pool.escolha')
  if (!['global', 'banco', 'projeto'].includes(c.fila.modo)) ruim('fila.modo')
  for (const [chave, [campo, min, max]] of Object.entries(FILA_INT)) {
    // Opcional (config escrita antes do campo): ausente vale o padrão.
    if (campo === 'semSaidaMin' && c.fila[campo] === undefined) continue
    if (!naFaixa(c.fila[campo], min, max)) ruim(chave)
  }
  if (c.fila.limparBancos !== undefined && typeof c.fila.limparBancos !== 'boolean') ruim('fila.limpar_bancos')
  if (c.pool.ignoradas !== undefined && (!Array.isArray(c.pool.ignoradas) || c.pool.ignoradas.some(n => typeof n !== 'string')))
    ruim('pool.ignoradas')
  const vistos = new Set<string>()
  for (const conta of c.pool.contas) {
    if (conta === null || typeof conta !== 'object') {
      ruim('pool.contas')
      continue
    }
    const prefixo = `conta.${conta.nome}`
    if (!NOME.test(conta.nome)) ruim(`${prefixo}.nome`)
    if (vistos.has(conta.nome)) ruim(prefixo, 'conta_repetida')
    vistos.add(conta.nome)
    const agente = acharAgente(conta.agente)
    if (!agente) ruim(`${prefixo}.agente`, 'agente_desconhecido')
    if (!naFaixa(conta.vagas, 0, 99)) ruim(`${prefixo}.vagas`)
    if (!naFaixa(conta.peso, 1, 100)) ruim(`${prefixo}.peso`)
    if (!Array.isArray(conta.papeis) || conta.papeis.some(p => !PAPEIS.includes(p))) ruim(`${prefixo}.papeis`)
    else if (agente && !agente.provado && conta.papeis.some(p => PAPEIS_TRABALHO.includes(p)))
      ruim(`${prefixo}.papeis`, 'agente_nao_provado')
    if (typeof conta.ativo !== 'boolean') ruim(`${prefixo}.ativo`)
    for (const campo of ['config', 'comando'] as const)
      if (conta[campo] != null && typeof conta[campo] !== 'string') ruim(`${prefixo}.${campo}`)
    if (conta.modelo !== null && !(typeof conta.modelo === 'string' && MODELO.test(conta.modelo))) ruim(`${prefixo}.modelo`)
    if (conta.origem !== 'orca' && conta.origem !== 'manual') ruim(`${prefixo}.origem`)
  }
  return erros
}

export function carregar(p: Paths): Config {
  let texto: string
  try {
    texto = readFileSync(p.config, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(PADRAO)
    throw new ErroConfig([{ chave: 'config', codigo: 'ilegivel' }], `não consegui ler ${p.config}: ${(err as Error).message}`)
  }
  // biome-ignore lint/suspicious/noExplicitAny: fronteira, `validar` confere os tipos antes de qualquer uso
  let cru: any
  try {
    cru = JSON.parse(texto)
  } catch {
    throw new ErroConfig([{ chave: 'config', codigo: 'json_invalido' }], `${p.config} não é JSON válido`)
  }
  if (cru === null || typeof cru !== 'object' || Array.isArray(cru)) recusa('config', 'config_invalida')
  if (cru.versao !== 1) recusa('versao', typeof cru.versao === 'number' ? 'versao_nao_suportada' : 'config_invalida')
  if (!cru.pool || typeof cru.pool !== 'object' || !Array.isArray(cru.pool.contas) || !cru.fila || typeof cru.fila !== 'object')
    recusa('config', 'config_invalida')
  // Config anterior ao campo `modelo`: ausente vira null.
  const contas = cru.pool.contas.map((x: unknown) => (x && typeof x === 'object' && !('modelo' in x) ? { ...x, modelo: null } : x))
  const c: Config = {
    versao: 1,
    pool: { ...PADRAO.pool, ...cru.pool, contas },
    fila: { ...PADRAO.fila, ...cru.fila },
  }
  const erros = validar(c)
  if (erros.length) throw new ErroConfig(erros)
  return c
}

/**
 * Lê, transforma e grava a config sob uma trava entre processos (worker, CLI): nenhuma gravação concorrente se perde.
 * `inicial` vale só quando o config.json ainda não existe (ex.: importar o legado em vez de partir do padrão vazio).
 */
export async function atualizarConfig(p: Paths, fn: (c: Config) => Config, inicial?: () => Config | null): Promise<Config> {
  try {
    return await comTrava(travaDaConfig(p), LIMITE_TRAVA_MS, () => transformar(p, fn, inicial))
  } catch (erro) {
    return trocarTravaOcupada(erro)
  }
}

const trocarTravaOcupada = (erro: unknown): never => {
  throw erro instanceof TravaOcupada ? configOcupada() : erro
}

const LIMITE_TRAVA_MS = 15_000

function travaDaConfig(p: Paths): string {
  mkdirSync(dirname(p.config), { recursive: true })
  return `${p.config}.lock`
}

const configOcupada = () => new ErroConfig([{ chave: 'config', codigo: 'config_ocupada' }], 'outra gravação da config em andamento')

function transformar(p: Paths, fn: (c: Config) => Config, inicial?: () => Config | null): Config {
  const base = existsSync(p.config) ? carregar(p) : (inicial?.() ?? carregar(p))
  const novo = fn(base)
  gravar(novo, p)
  return novo
}

/** Gravação atômica; recusa config inválida antes de tocar no disco. */
export function gravar(c: Config, p: Paths): void {
  const erros = validar(c)
  if (erros.length) throw new ErroConfig(erros)
  mkdirSync(dirname(p.config), { recursive: true })
  gravarAtomico(p.config, `${JSON.stringify(c, null, 2)}\n`)
}
