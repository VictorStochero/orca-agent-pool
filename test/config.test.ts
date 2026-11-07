import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { deduzirAgente } from '../src/core/catalogo.ts'
import { carregar, ErroConfig, gravar, PADRAO, validar } from '../src/core/config.ts'
import { aplicar } from '../src/core/config-chaves.ts'
import { paths } from '../src/core/paths.ts'
import type { Config, Conta } from '../src/core/tipos.ts'

function casa() {
  const home = mkdtempSync(join(tmpdir(), 'ap-cfg-'))
  return { home, p: paths(home), fim: () => rmSync(home, { recursive: true, force: true }) }
}

const conta = (nome: string, extra: Partial<Conta> = {}): Conta => ({
  nome,
  agente: 'claude',
  config: null,
  comando: null,
  modelo: null,
  vagas: 1,
  peso: 1,
  papeis: ['escritor'],
  ativo: true,
  origem: 'manual',
  ...extra,
})
const com = (...contas: Conta[]): Config => ({ ...structuredClone(PADRAO), pool: { ...PADRAO.pool, contas } })
const recusa = (fn: () => unknown, codigo: string) =>
  assert.throws(fn, (e: unknown) => e instanceof ErroConfig && e.erros.some(x => x.codigo === codigo))

test('carregar sem arquivo devolve PADRAO', () => {
  const { p, fim } = casa()
  assert.deepEqual(carregar(p), PADRAO)
  fim()
})

test('carregar com JSON inválido lança ErroConfig e não grava', () => {
  const { p, fim } = casa()
  mkdirSync(p.raiz, { recursive: true })
  writeFileSync(p.config, '{ quebrado')
  assert.throws(() => carregar(p), ErroConfig)
  assert.equal(readFileSync(p.config, 'utf8'), '{ quebrado')
  assert.deepEqual(readdirSync(p.raiz), ['config.json'])
  fim()
})

test('carregar com versao 2 lança ErroConfig', () => {
  const { p, fim } = casa()
  mkdirSync(p.raiz, { recursive: true })
  const futuro = JSON.stringify({ ...PADRAO, versao: 2 })
  writeFileSync(p.config, futuro)
  recusa(() => carregar(p), 'versao_nao_suportada')
  assert.equal(readFileSync(p.config, 'utf8'), futuro)
  fim()
})

test('carregar recusa ignoradas fora de lista de textos e config/comando que não são texto', () => {
  const { p, fim } = casa()
  mkdirSync(p.raiz, { recursive: true })
  for (const ruim of [
    { ...PADRAO, pool: { ...PADRAO.pool, ignoradas: 'claude-padrao' } },
    { ...PADRAO, pool: { ...PADRAO.pool, ignoradas: [1] } },
    { ...PADRAO, pool: { ...PADRAO.pool, contas: [conta('a', { config: 5 as unknown as string })] } },
    { ...PADRAO, pool: { ...PADRAO.pool, contas: [conta('a', { comando: [] as unknown as string })] } },
  ]) {
    writeFileSync(p.config, JSON.stringify(ruim))
    assert.throws(() => carregar(p), ErroConfig)
  }
  fim()
})

test('carregar devolve o que foi gravado', () => {
  const { p, fim } = casa()
  const c = aplicar(PADRAO, { 'conta.a.adicionar': 'claude', 'fila.vagas': '4' })
  gravar(c, p)
  assert.deepEqual(carregar(p), c)
  fim()
})

test('aplicar pool.ordem reordena e recusa nome desconhecido, repetido ou lista incompleta', () => {
  const c = com(conta('a'), conta('b'), conta('c'))
  assert.deepEqual(
    aplicar(c, { 'pool.ordem': 'c,a,b' }).pool.contas.map(x => x.nome),
    ['c', 'a', 'b'],
  )
  recusa(() => aplicar(c, { 'pool.ordem': 'a,b,z' }), 'conta_inexistente')
  recusa(() => aplicar(c, { 'pool.ordem': 'a,a,b' }), 'conta_repetida')
  recusa(() => aplicar(c, { 'pool.ordem': 'a,b' }), 'ordem_incompleta')
})

test("aplicar conta.x.adicionar=auto com 'CLAUDE_CONFIG_DIR=~/.claude-work claude' deduz claude e grava config ~/.claude-work", () => {
  const c = aplicar(PADRAO, {
    'conta.x.adicionar': 'auto',
    'conta.x.comando': 'CLAUDE_CONFIG_DIR=~/.claude-work claude',
  })
  const x = c.pool.contas[0]
  assert.equal(x.agente, 'claude')
  assert.equal(x.config, '~/.claude-work')
  assert.equal(x.comando, null)
  assert.equal(x.origem, 'manual')
  assert.deepEqual([x.vagas, x.peso, x.ativo], [1, 1, true])
})

test('adicionar=auto: valor com = não é cortado no segundo = e a validação única recusa o caractere', () => {
  recusa(() => aplicar(PADRAO, { 'conta.x.adicionar': 'auto', 'conta.x.comando': 'CLAUDE_CONFIG_DIR=C:\\a=b claude' }), 'valor_invalido')
  recusa(() => aplicar(PADRAO, { 'conta.x.adicionar': 'auto', 'conta.x.comando': 'FOO=1 claude' }), 'variavel_sem_suporte')
})

test('fila.espera_max_s é configurável dentro da faixa', () => {
  assert.equal(aplicar(PADRAO, { 'fila.espera_max_s': '600' }).fila.esperaMaxS, 600)
  recusa(() => aplicar(PADRAO, { 'fila.espera_max_s': '0' }), 'valor_invalido')
  recusa(() => aplicar(PADRAO, { 'fila.espera_max_s': '86401' }), 'valor_invalido')
})

test('validar e carregar com conta null dão ErroConfig, não TypeError', () => {
  const { p, fim } = casa()
  mkdirSync(join(p.config, '..'), { recursive: true })
  writeFileSync(p.config, JSON.stringify({ versao: 1, pool: { contas: [null] }, fila: {} }))
  recusa(() => carregar(p), 'valor_invalido')
  fim()
})

test('aplicar adicionar=auto só com diretório de config deduz claude', () => {
  const c = aplicar(PADRAO, { 'conta.y.adicionar': 'auto', 'conta.y.config': '~/.claude-y' })
  assert.equal(c.pool.contas[0].agente, 'claude')
})

test("aplicar com comando desconhecido recusa com codigo 'agente_desconhecido'", () => {
  recusa(() => aplicar(PADRAO, { 'conta.x.adicionar': 'auto', 'conta.x.comando': 'programa-estranho --x' }), 'agente_desconhecido')
  recusa(() => aplicar(PADRAO, { 'conta.x.adicionar': 'inexistente' }), 'agente_desconhecido')
})

test('papel de trabalho em agente com provado=false é recusado', () => {
  const c = com(conta('o', { agente: 'opencode', papeis: [] }))
  recusa(() => aplicar(c, { 'conta.o.papeis': 'escritor' }), 'agente_nao_provado')
  assert.deepEqual(validar(com(conta('o', { agente: 'opencode', papeis: ['revisor'] }))), [
    { chave: 'conta.o.papeis', codigo: 'agente_nao_provado' },
  ])
  assert.deepEqual(validar(com(conta('o', { agente: 'opencode', papeis: ['segunda-opiniao'] }))), [])
})

test('aplicar edita chaves de fila e pool e recusa valores fora da faixa', () => {
  const c = aplicar(PADRAO, {
    'fila.modo': 'projeto',
    'fila.processos': '4',
    'pool.teto': '2',
    'pool.ram_min': '3.5',
    'pool.escolha': 'ordem',
  })
  assert.equal(c.fila.modo, 'projeto')
  assert.equal(c.fila.processos, 4)
  assert.equal(c.pool.teto, 2)
  assert.equal(c.pool.ramMinGb, 3.5)
  assert.equal(c.pool.escolha, 'ordem')
  recusa(() => aplicar(PADRAO, { 'fila.vagas': '0' }), 'valor_invalido')
  recusa(() => aplicar(PADRAO, { 'fila.modo': 'xis' }), 'valor_invalido')
  recusa(() => aplicar(PADRAO, { 'fila.nada': '1' }), 'chave_desconhecida')
  recusa(() => aplicar(PADRAO, { toString: '1' }), 'chave_desconhecida')
  assert.equal(PADRAO.fila.vagas, 2, 'não muta a entrada')
})

test('aplicar campos de conta, ativo=nao e remover; tudo ou nada', () => {
  const c = com(conta('a'), conta('b'))
  const r = aplicar(c, { 'conta.a.vagas': '3', 'conta.a.ativo': 'nao', 'conta.b.remover': '1' })
  assert.equal(r.pool.contas.length, 1)
  assert.deepEqual([r.pool.contas[0].vagas, r.pool.contas[0].ativo], [3, false])
  recusa(() => aplicar(c, { 'conta.a.vagas': '3', 'conta.z.vagas': '1' }), 'conta_inexistente')
  assert.equal(c.pool.contas[0].vagas, 1)
})

test('gravar é atômico (falha no rename não deixa arquivo parcial)', () => {
  const { p, fim } = casa()
  mkdirSync(join(p.config, 'x'), { recursive: true }) // config.json é diretório não vazio: o rename falha
  assert.throws(() => gravar(PADRAO, p))
  assert.deepEqual(readdirSync(p.raiz), ['config.json'])
  assert.ok(existsSync(join(p.config, 'x')))
  fim()
})

test('gravar recusa config inválida sem tocar no disco', () => {
  const { p, fim } = casa()
  const ruim = com(conta('a', { vagas: -1 }))
  recusa(() => gravar(ruim, p), 'valor_invalido')
  assert.equal(existsSync(p.raiz), false)
  fim()
})

test('deduzirAgente: executável do comando, VAR=valor à frente, opencode2 só por id', () => {
  assert.equal(deduzirAgente('CLAUDE_CONFIG_DIR=~/x claude --flag', null)?.id, 'claude')
  assert.equal(deduzirAgente('C:\\bin\\codex.exe', null)?.id, 'codex')
  assert.equal(deduzirAgente('agy', null)?.id, 'antigravity')
  assert.equal(deduzirAgente('opencode', null)?.id, 'opencode')
  assert.equal(deduzirAgente(null, '~/.claude-work')?.id, 'claude')
  assert.equal(deduzirAgente('foo', null), null)
  assert.equal(deduzirAgente(null, null), null)
})

test('modelo: config antiga sem o campo vira null; set grava, valida e limpa', () => {
  const { p, fim } = casa()
  mkdirSync(p.raiz, { recursive: true })
  const { modelo: _, ...antiga } = conta('a')
  writeFileSync(p.config, JSON.stringify({ ...PADRAO, pool: { ...PADRAO.pool, contas: [antiga] } }))
  const c = carregar(p)
  assert.equal(c.pool.contas[0].modelo, null)
  const com1 = aplicar(c, { 'conta.a.modelo': 'gemini-3.8-flash-high' })
  assert.equal(com1.pool.contas[0].modelo, 'gemini-3.8-flash-high')
  assert.equal(aplicar(com1, { 'conta.a.modelo': '' }).pool.contas[0].modelo, null)
  for (const ruim of ['a b', 'x;y', 'x'.repeat(101), '-x', '--dangerously-skip-permissions'])
    recusa(() => aplicar(c, { 'conta.a.modelo': ruim }), 'valor_invalido')
  writeFileSync(p.config, JSON.stringify({ ...PADRAO, pool: { ...PADRAO.pool, contas: [conta('a', { modelo: 5 as unknown as string })] } }))
  assert.throws(() => carregar(p), ErroConfig)
  fim()
})

test('fila.limpar_bancos: desligado por padrão e em config antiga; liga e desliga só com sim/nao', () => {
  assert.equal(PADRAO.fila.limparBancos, false)
  const { p, fim } = casa()
  try {
    mkdirSync(p.raiz, { recursive: true })
    const { limparBancos: _, ...filaAntiga } = PADRAO.fila
    writeFileSync(p.config, JSON.stringify({ ...PADRAO, fila: filaAntiga }))
    assert.equal(carregar(p).fila.limparBancos, false)
  } finally {
    fim()
  }
  const ligado = aplicar(PADRAO, { 'fila.limpar_bancos': 'sim' })
  assert.equal(ligado.fila.limparBancos, true)
  assert.equal(aplicar(ligado, { 'fila.limpar_bancos': 'nao' }).fila.limparBancos, false)
  recusa(() => aplicar(PADRAO, { 'fila.limpar_bancos': '1' }), 'valor_invalido')
  assert.deepEqual(validar({ ...PADRAO, fila: { ...PADRAO.fila, limparBancos: 'sim' as never } }), [
    { chave: 'fila.limpar_bancos', codigo: 'valor_invalido' },
  ])
})

test('config.json já gravada com caminho acentuado carrega; a entrada nova com esse caminho é recusada', () => {
  const { p, fim } = casa()
  const gravada = com(conta('w', { config: 'C:/Users/João/.claude-w', comando: 'claude --x ã' }))
  mkdirSync(join(p.config, '..'), { recursive: true })
  writeFileSync(p.config, JSON.stringify(gravada))
  assert.equal(carregar(p).pool.contas[0].config, 'C:/Users/João/.claude-w')
  recusa(() => aplicar(PADRAO, { 'conta.n.adicionar': 'auto', 'conta.n.config': 'C:/Users/João/.claude-n' }), 'valor_invalido')
  recusa(() => aplicar(gravada, { 'conta.w.config': 'C:/Users/João/outro' }), 'valor_invalido')
  fim()
})
