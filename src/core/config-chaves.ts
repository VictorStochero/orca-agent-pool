import { acharAgente, deduzirAgente, executavelDe } from './catalogo.ts'
import { caracteresValidos, ErroConfig, FILA_INT, NOME, recusa, validar } from './config.ts'
import { separarAtribuicoes } from './executavel.ts'
import type { Config, Conta, Papel } from './tipos.ts'

/** `recurso` é o nome antigo do modo `banco`. */
export const modoDeFila = (v: string): string => (v === 'recurso' ? 'banco' : v)

const lista = (v: string): string[] => (v === '' ? [] : v.split(','))

function aplicarContaNova(nova: Config, nome: string, valor: string, valores: Record<string, string>): void {
  const chave = `conta.${nome}.adicionar`
  if (!NOME.test(nome)) recusa(chave, 'valor_invalido')
  if (nova.pool.contas.some(c => c.nome === nome)) recusa(chave, 'conta_existente')
  let comando = valores[`conta.${nome}.comando`] || null
  let config = valores[`conta.${nome}.config`] || null
  let agente = valor === 'auto' ? null : acharAgente(valor)
  if (valor === 'auto') {
    const { vars, resto } = separarAtribuicoes(comando?.split(/\s+/) ?? [])
    for (const [variavel, valorVariavel] of vars) {
      if (variavel !== 'CLAUDE_CONFIG_DIR') recusa(`conta.${nome}.comando`, 'variavel_sem_suporte')
      config ??= valorVariavel
    }
    comando = resto.join(' ') || null
    agente = deduzirAgente(comando, config)
    // O comando do próprio catálogo não precisa ser gravado.
    if (agente && comando && resto.length === 1 && executavelDe(comando) === agente.comandos[0]) comando = null
    if (config) valores[`conta.${nome}.config`] = config
    if (comando) valores[`conta.${nome}.comando`] = comando
    else delete valores[`conta.${nome}.comando`]
  }
  if (!agente) recusa(chave, 'agente_desconhecido')
  if (!caracteresValidos('config', config ?? '')) recusa(`conta.${nome}.config`, 'valor_invalido')
  if (!caracteresValidos('comando', comando ?? '')) recusa(`conta.${nome}.comando`, 'valor_invalido')
  nova.pool.contas.push({
    nome,
    agente: agente!.id,
    config,
    comando,
    modelo: null,
    vagas: 1,
    peso: 1,
    papeis: [...agente!.papeisPadrao],
    ativo: true,
    origem: 'manual',
  })
}

/** Texto de dígitos como número; outro texto vira NaN e `validar` o recusa na chave certa. */
const inteiroDe = (v: string): number => (/^[0-9]+$/.test(v) ? +v : Number.NaN)

/** 'sim'/'nao' como booleano; outro texto fica como veio e `validar` o recusa. */
function simNao(v: string): boolean {
  if (v === 'sim') return true
  return (v === 'nao' ? false : v) as boolean
}

/** Converte o formato; faixas são de `validar` e os caracteres de config/comando, conferidos aqui, no valor que entra. */
function aplicarCampo(conta: Conta, campo: string, v: string, chave: string): void {
  if ((campo === 'config' || campo === 'comando') && !caracteresValidos(campo, v)) recusa(chave, 'valor_invalido')
  if (campo === 'vagas') conta.vagas = inteiroDe(v)
  else if (campo === 'peso') conta.peso = inteiroDe(v)
  else if (campo === 'papeis') conta.papeis = lista(v) as Papel[]
  else if (campo === 'ativo') conta.ativo = simNao(v)
  else if (campo === 'config') conta.config = v || null
  else if (campo === 'comando') conta.comando = v || null
  else if (campo === 'modelo') conta.modelo = v || null
}

/** Aplica mudanças `chave=valor` sem alterar `c`; tudo ou nada. Converte o formato; `validar` confere faixas e caracteres. */
export function aplicar(c: Config, mudancas: Record<string, string>): Config {
  const nova = structuredClone(c)
  const valores: Record<string, string> = Object.fromEntries(Object.entries(mudancas).map(([chave, v]) => [chave, v.trim()]))
  const contaDe = (nome: string, chave: string) => nova.pool.contas.find(conta => conta.nome === nome) ?? recusa(chave, 'conta_inexistente')
  let ordem: string[] | null = null
  const porConta: [string, string, string][] = []
  const adicionar: [string, string][] = []
  const remover: [string, string][] = []

  for (const [chave, v] of Object.entries(valores)) {
    if (Object.hasOwn(FILA_INT, chave)) nova.fila[FILA_INT[chave][0]] = inteiroDe(v) as never
    else if (chave === 'fila.modo') nova.fila.modo = modoDeFila(v) as Config['fila']['modo']
    else if (chave === 'fila.limpar_bancos') nova.fila.limparBancos = simNao(v)
    else if (chave === 'pool.teto') nova.pool.teto = inteiroDe(v)
    else if (chave === 'pool.ram_min') nova.pool.ramMinGb = /^[0-9]+(\.[0-9]+)?$/.test(v) ? +v : Number.NaN
    else if (chave === 'pool.escolha') nova.pool.escolha = v as 'ritmo' | 'ordem'
    else if (chave === 'pool.ordem') ordem = lista(v)
    else {
      const partes = /^conta\.([a-z0-9_-]{1,32})\.(vagas|peso|papeis|config|comando|modelo|ativo|adicionar|remover)$/.exec(chave)
      if (!partes) recusa(chave, 'chave_desconhecida')
      const [, nome, campo] = partes!
      if (campo === 'adicionar') adicionar.push([nome, v])
      else if (campo === 'remover') {
        if (v !== '1') recusa(chave, 'valor_invalido')
        remover.push([nome, chave])
      } else porConta.push([nome, campo, chave])
    }
  }

  for (const [nome, v] of adicionar) {
    aplicarContaNova(nova, nome, v, valores)
    if (nova.pool.ignoradas) nova.pool.ignoradas = nova.pool.ignoradas.filter(ignorada => ignorada !== nome)
  }
  const removidas = new Set(remover.map(([nome]) => nome))
  for (const [nome, campo, chave] of porConta) {
    if (removidas.has(nome)) continue
    // comando/config da conta nova podem ter sido normalizados em aplicarContaNova.
    aplicarCampo(contaDe(nome, chave), campo, valores[chave] ?? '', chave)
  }
  for (const [nome, chave] of remover) {
    if (contaDe(nome, chave).origem === 'orca') nova.pool.ignoradas = [...new Set([...(nova.pool.ignoradas ?? []), nome])]
    nova.pool.contas = nova.pool.contas.filter(conta => conta.nome !== nome)
  }
  if (ordem) {
    if (new Set(ordem).size !== ordem.length) recusa('pool.ordem', 'conta_repetida')
    if (ordem.some(o => !nova.pool.contas.some(conta => conta.nome === o))) recusa('pool.ordem', 'conta_inexistente')
    if (ordem.length !== nova.pool.contas.length) recusa('pool.ordem', 'ordem_incompleta')
    nova.pool.contas = ordem.map(o => nova.pool.contas.find(conta => conta.nome === o)!)
  }
  const erros = validar(nova)
  if (erros.length) throw new ErroConfig(erros)
  return nova
}
