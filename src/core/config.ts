import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PAPEIS_TRABALHO, acharAgente, deduzirAgente, executavelDe } from './catalogo.ts'
import { adquirir } from './fila/travas.ts'
import type { Paths } from './paths.ts'
import type { Config, Conta, Papel } from './tipos.ts'

export type ErroValidacao = { chave: string; codigo: string }

export class ErroConfig extends Error {
  erros: ErroValidacao[]
  constructor(erros: ErroValidacao[], mensagem?: string) {
    super(mensagem ?? erros.map((e) => `${e.chave}: ${e.codigo}`).join('; '))
    this.name = 'ErroConfig'
    this.erros = erros
  }
}

export const PADRAO: Config = {
  versao: 1,
  pool: { teto: 0, ramMinGb: 0, escolha: 'ritmo', contas: [] },
  fila: { modo: 'banco', vagas: 2, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 300 }
}

const PAPEIS: readonly Papel[] = ['orquestra', 'revisor', 'verificador', 'escritor', 'segunda-opiniao', 'mecanico']
const NOME = /^[a-z0-9_-]{1,32}$/
const FILA_INT: Record<string, [keyof Config['fila'], number, number]> = {
  'fila.vagas': ['vagas', 1, 99],
  'fila.vagas_projeto': ['vagasPorProjeto', 1, 99],
  'fila.teto': ['teto', 1, 99],
  'fila.processos': ['processos', 1, 64]
}

const recusa = (chave: string, codigo: string): never => {
  throw new ErroConfig([{ chave, codigo }])
}

const naFaixa = (v: unknown, min: number, max: number, inteiro = true): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!inteiro || Number.isInteger(v))

export function validar(c: Config): ErroValidacao[] {
  const e: ErroValidacao[] = []
  const ruim = (chave: string, codigo = 'valor_invalido') => e.push({ chave, codigo })
  if (c.versao !== 1) ruim('versao', 'versao_nao_suportada')
  if (!naFaixa(c.pool.teto, 0, 99)) ruim('pool.teto')
  if (!naFaixa(c.pool.ramMinGb, 0, 1024, false)) ruim('pool.ram_min')
  if (c.pool.escolha !== 'ritmo' && c.pool.escolha !== 'ordem') ruim('pool.escolha')
  if (!['global', 'banco', 'projeto'].includes(c.fila.modo)) ruim('fila.modo')
  for (const [chave, [campo, min, max]] of Object.entries(FILA_INT)) if (!naFaixa(c.fila[campo], min, max)) ruim(chave)
  if (!naFaixa(c.fila.esperaMaxS, 1, 86400)) ruim('fila.espera_max_s')
  if (c.pool.ignoradas !== undefined && (!Array.isArray(c.pool.ignoradas) || c.pool.ignoradas.some((n) => typeof n !== 'string'))) ruim('pool.ignoradas')
  const vistos = new Set<string>()
  for (const x of c.pool.contas) {
    const k = `conta.${x.nome}`
    if (!NOME.test(x.nome)) ruim(`${k}.nome`)
    if (vistos.has(x.nome)) ruim(k, 'conta_repetida')
    vistos.add(x.nome)
    const agente = acharAgente(x.agente)
    if (!agente) ruim(`${k}.agente`, 'agente_desconhecido')
    if (!naFaixa(x.vagas, 0, 99)) ruim(`${k}.vagas`)
    if (!naFaixa(x.peso, 1, 100)) ruim(`${k}.peso`)
    if (!Array.isArray(x.papeis) || x.papeis.some((p) => !PAPEIS.includes(p))) ruim(`${k}.papeis`)
    else if (agente && !agente.provado && x.papeis.some((p) => PAPEIS_TRABALHO.includes(p))) ruim(`${k}.papeis`, 'agente_nao_provado')
    if (typeof x.ativo !== 'boolean') ruim(`${k}.ativo`)
    for (const campo of ['config', 'comando'] as const) if (x[campo] != null && typeof x[campo] !== 'string') ruim(`${k}.${campo}`)
    if (x.origem !== 'orca' && x.origem !== 'manual') ruim(`${k}.origem`)
  }
  return e
}

export function carregar(p: Paths): Config {
  let texto: string
  try {
    texto = readFileSync(p.config, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(PADRAO)
    throw new ErroConfig([{ chave: 'config', codigo: 'ilegivel' }], `não consegui ler ${p.config}: ${(err as Error).message}`)
  }
  let cru: any // fronteira: `validar` confere os tipos antes de qualquer uso
  try {
    cru = JSON.parse(texto)
  } catch {
    throw new ErroConfig([{ chave: 'config', codigo: 'json_invalido' }], `${p.config} não é JSON válido`)
  }
  if (cru === null || typeof cru !== 'object' || Array.isArray(cru)) recusa('config', 'config_invalida')
  if (cru.versao !== 1) recusa('versao', typeof cru.versao === 'number' ? 'versao_nao_suportada' : 'config_invalida')
  if (!cru.pool || typeof cru.pool !== 'object' || !Array.isArray(cru.pool.contas) || !cru.fila || typeof cru.fila !== 'object') recusa('config', 'config_invalida')
  const c: Config = {
    versao: 1,
    pool: { ...PADRAO.pool, ...cru.pool },
    fila: { ...PADRAO.fila, ...cru.fila }
  }
  const erros = validar(c)
  if (erros.length) throw new ErroConfig(erros)
  return c
}

const lista = (v: string): string[] => (v === '' ? [] : v.split(','))

function aplicarContaNova(n: Config, nome: string, valor: string, m: Record<string, string>): void {
  const chave = `conta.${nome}.adicionar`
  if (!NOME.test(nome)) recusa(chave, 'valor_invalido')
  if (n.pool.contas.some((x) => x.nome === nome)) recusa(chave, 'conta_existente')
  let comando = m[`conta.${nome}.comando`] || null
  let config = m[`conta.${nome}.config`] || null
  let agente = valor === 'auto' ? null : acharAgente(valor)
  if (valor === 'auto') {
    const toks = comando?.split(/\s+/) ?? []
    while (toks.length && /^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(toks[0])) {
      const [k, v] = toks.shift()!.split('=', 2)
      if (k !== 'CLAUDE_CONFIG_DIR') recusa(`conta.${nome}.comando`, 'variavel_sem_suporte')
      config ??= v
    }
    comando = toks.join(' ') || null
    agente = deduzirAgente(comando, config)
    // O comando do próprio catálogo não precisa ser gravado.
    if (agente && comando && toks.length === 1 && executavelDe(comando) === agente.comandos[0]) comando = null
    if (config) m[`conta.${nome}.config`] = config
    if (comando) m[`conta.${nome}.comando`] = comando
    else delete m[`conta.${nome}.comando`]
  }
  if (!agente) recusa(chave, 'agente_desconhecido')
  n.pool.contas.push({
    nome, agente: agente!.id, config, comando, vagas: 1, peso: 1,
    papeis: [...agente!.papeisPadrao], ativo: true, origem: 'manual'
  })
}

function aplicarCampo(x: Conta, campo: string, v: string, chave: string): void {
  const inteiro = (min: number, max: number) => {
    if (!/^[0-9]+$/.test(v) || +v < min || +v > max) recusa(chave, 'valor_invalido')
    return +v
  }
  if (campo === 'vagas') x.vagas = inteiro(0, 99)
  else if (campo === 'peso') x.peso = inteiro(1, 100)
  else if (campo === 'papeis') {
    if (!lista(v).every((p) => PAPEIS.includes(p as Papel))) recusa(chave, 'valor_invalido')
    x.papeis = lista(v) as Papel[]
  } else if (campo === 'ativo') {
    if (v !== 'sim' && v !== 'nao') recusa(chave, 'valor_invalido')
    x.ativo = v === 'sim'
  } else if (campo === 'config') {
    if (v !== '' && !/^[~A-Za-z0-9_./:\\@+-]+$/.test(v)) recusa(chave, 'valor_invalido')
    x.config = v || null
  } else if (campo === 'comando') {
    if (v !== '' && !/^[~A-Za-z0-9_./:\\@+= -]+$/.test(v)) recusa(chave, 'valor_invalido')
    x.comando = v || null
  }
}

/** Aplica mudanças `chave=valor` sem alterar `c`; tudo ou nada. */
export function aplicar(c: Config, mudancas: Record<string, string>): Config {
  const n = structuredClone(c)
  const m: Record<string, string> = Object.fromEntries(Object.entries(mudancas).map(([k, v]) => [k, v.trim()]))
  const contaDe = (nome: string, chave: string) => n.pool.contas.find((x) => x.nome === nome) ?? recusa(chave, 'conta_inexistente')
  let ordem: string[] | null = null
  const porConta: [string, string, string, string][] = []
  const adicionar: [string, string][] = []
  const remover: [string, string][] = []

  for (const [chave, v] of Object.entries(m)) {
    if (chave in FILA_INT) {
      const [campo, min, max] = FILA_INT[chave]
      if (!/^[0-9]+$/.test(v) || +v < min || +v > max) recusa(chave, 'valor_invalido')
      n.fila[campo] = +v as never
    } else if (chave === 'fila.modo') {
      const modo = v === 'recurso' ? 'banco' : v
      if (modo !== 'global' && modo !== 'banco' && modo !== 'projeto') recusa(chave, 'valor_invalido')
      n.fila.modo = modo as Config['fila']['modo']
    } else if (chave === 'pool.teto') {
      if (!/^[0-9]+$/.test(v) || +v > 99) recusa(chave, 'valor_invalido')
      n.pool.teto = +v
    } else if (chave === 'pool.ram_min') {
      if (!/^[0-9]+(\.[0-9]+)?$/.test(v) || +v > 1024) recusa(chave, 'valor_invalido')
      n.pool.ramMinGb = +v
    } else if (chave === 'pool.escolha') {
      if (v !== 'ritmo' && v !== 'ordem') recusa(chave, 'valor_invalido')
      n.pool.escolha = v as 'ritmo' | 'ordem'
    } else if (chave === 'pool.ordem') {
      ordem = lista(v)
    } else {
      const k = /^conta\.([a-z0-9_-]{1,32})\.(vagas|peso|papeis|config|comando|ativo|adicionar|remover)$/.exec(chave)
      if (!k) recusa(chave, 'chave_desconhecida')
      const [, nome, campo] = k!
      if (campo === 'adicionar') adicionar.push([nome, v])
      else if (campo === 'remover') {
        if (v !== '1') recusa(chave, 'valor_invalido')
        remover.push([nome, chave])
      } else porConta.push([nome, campo, v, chave])
    }
  }

  for (const [nome, v] of adicionar) {
    aplicarContaNova(n, nome, v, m)
    if (n.pool.ignoradas) n.pool.ignoradas = n.pool.ignoradas.filter((x) => x !== nome)
  }
  const removidas = new Set(remover.map(([nome]) => nome))
  for (const [nome, campo, , chave] of porConta) {
    if (removidas.has(nome)) continue
    // comando/config da conta nova podem ter sido normalizados em aplicarContaNova.
    aplicarCampo(contaDe(nome, chave), campo, m[chave] ?? '', chave)
  }
  for (const [nome, chave] of remover) {
    contaDe(nome, chave)
    if (contaDe(nome, chave).origem === 'orca') n.pool.ignoradas = [...new Set([...(n.pool.ignoradas ?? []), nome])]
    n.pool.contas = n.pool.contas.filter((x) => x.nome !== nome)
  }
  if (ordem) {
    if (new Set(ordem).size !== ordem.length) recusa('pool.ordem', 'conta_repetida')
    if (ordem.some((o) => !n.pool.contas.some((x) => x.nome === o))) recusa('pool.ordem', 'conta_inexistente')
    if (ordem.length !== n.pool.contas.length) recusa('pool.ordem', 'ordem_incompleta')
    n.pool.contas = ordem.map((o) => n.pool.contas.find((x) => x.nome === o)!)
  }
  const erros = validar(n)
  if (erros.length) throw new ErroConfig(erros)
  return n
}

/**
 * Lê, transforma e grava a config sob uma trava entre processos (worker, CLI): nenhuma gravação concorrente se perde.
 * `inicial` vale só quando o config.json ainda não existe (ex.: importar o legado em vez de partir do padrão vazio).
 */
export function atualizarConfig(p: Paths, fn: (c: Config) => Config, inicial?: () => Config | null): Config {
  mkdirSync(dirname(p.config), { recursive: true })
  const trava = `${p.config}.lock`
  if (!adquirir(trava, 15_000)) throw new ErroConfig([{ chave: 'config', codigo: 'config_ocupada' }], 'outra gravação da config em andamento')
  try {
    const base = existsSync(p.config) ? carregar(p) : (inicial?.() ?? carregar(p))
    const novo = fn(base)
    gravar(novo, p)
    return novo
  } finally {
    rmSync(trava, { recursive: true, force: true })
  }
}

/** Gravação atômica (temporário + rename); recusa config inválida antes de tocar no disco. */
export function gravar(c: Config, p: Paths): void {
  const erros = validar(c)
  if (erros.length) throw new ErroConfig(erros)
  mkdirSync(dirname(p.config), { recursive: true })
  const tmp = `${p.config}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n')
    renameSync(tmp, p.config)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {}
    throw err
  }
}
