// Painel alimentado pelo estado montado pelo worker de verdade (não por fixture escrita à mão).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import type { Estado } from '../protocol'
import { cfg, conta } from '../../test/helpers/pool.ts'
import { paths } from '../core/paths.ts'
import type { Medida } from '../core/tipos.ts'
import { AMBIENTE_VAZIO, montarEstado } from '../worker/estado.ts'
import { criarRequisitos } from '../worker/requisitos.ts'
import * as panel from './panel'

let view: TestPanel | undefined
afterEach(() => view?.unmount())

const AGORA = 1_800_000_000_000
const medida = (c: string, extra: Partial<Medida>): Medida => ({ conta: c, curta: null, longa: null, resetLongaTs: null, estado: 'sem_medida', medidaTs: AGORA, ...extra })

function estadoReal(opcoes: { contas?: ReturnType<typeof conta>[]; medidas?: Medida[]; parado?: boolean; testes?: boolean; orca?: Estado['saude']['orca'] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'painel-real-'))
  try {
    const p = paths(home)
    if (opcoes.parado) {
      const dir = join(p.fila, 'x', '1')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'info.json'), JSON.stringify({ pid: 2147483000, inicio: 1, projeto: 'wt' }))
    }
    return montarEstado(p, cfg(opcoes.contas ?? [conta('alfa'), conta('beta')]), null, { ...AMBIENTE_VAZIO, medidas: opcoes.medidas ?? [], orca: opcoes.orca ?? { rodando: false, versao: null } }, AGORA)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}
const hostCom = (estado: Estado, extra: Record<string, () => unknown> = {}) =>
  mockHost({ requests: { 'estado.ler': () => estado, 'hooks.estado': () => [], 'requisitos.ler': () => ({ ok: true, itens: [] }), ...extra } as never })

test('en: alertas do worker real (sem login, erro de medida, Orca fora, teste parado) saem em inglês', async () => {
  const e = estadoReal({
    medidas: [medida('alfa', { estado: 'sem_login', acao: 'claude auth login' }), medida('beta', { estado: 'erro' })],
    parado: true
  })
  view = await mount(panel, { locale: 'en', host: hostCom(e) })
  const bloco = view.find({ type: 'Callout', text: /Attention/ })
  assert.ok(bloco)
  assert.equal(view.find({ type: 'Callout', text: /sem login|parado|indispon|ilegível|medição/ }), null)
  for (const trecho of [/alfa.*not signed in/, /beta/, /Orca unavailable/, /Stopped test/]) assert.ok(view.find({ type: 'Callout', text: trecho }), String(trecho))
})

test('pt-BR: os mesmos alertas saem em português', async () => {
  const e = estadoReal({ medidas: [medida('alfa', { estado: 'sem_login' })], parado: true })
  view = await mount(panel, { locale: 'pt-BR', host: hostCom(e) })
  for (const trecho of [/alfa: sem login/, /Orca indisponível/, /Teste parado/]) assert.ok(view.find({ type: 'Callout', text: trecho }), String(trecho))
})

test('Orca ainda não verificado: rodapé "verificando"/"checking" e sem alerta', async () => {
  const e = estadoReal({ orca: { rodando: null, versao: null } })
  view = await mount(panel, { locale: 'pt-BR', host: hostCom(e) })
  assert.ok(view.find({ text: /Orca verificando/ }))
  assert.equal(view.find({ text: /fora do ar|Orca indisponível/ }), null)
  view.unmount()
  view = await mount(panel, { locale: 'en', host: hostCom(e) })
  assert.ok(view.find({ text: /Orca checking/ }))
  assert.equal(view.find({ text: /unavailable/ }), null)
})

test('en: requisitos do worker real saem em inglês', async () => {
  const r = await criarRequisitos({
    orca: async (a) => { if (a[0] === '--version') return '1.4.246'; throw new Error('boom') },
    skill: () => ({ estado: 'ausente' }),
    lancador: () => false,
    hooks: () => [{ agente: 'claude', estado: 'ausente' }],
    instalar: async () => {}
  }).ler()
  view = await mount(panel, { locale: 'en', host: hostCom(estadoReal(), { 'requisitos.ler': () => r }) })
  assert.equal(view.find({ text: /não verificado|não instalad|ausente/ }), null)
  assert.ok(view.find({ text: /not verified/i }))
  assert.ok(view.find({ text: /not installed/i }))
})

test('en: erro do worker com código vira texto do idioma, sem a frase do worker', async () => {
  const e = estadoReal()
  view = await mount(panel, {
    locale: 'en',
    host: hostCom(e, { 'hooks.estado': () => [{ agente: 'claude', estado: 'ausente' }], 'hooks.reinstalar': () => { throw Object.assign(new Error('x'), { code: 'hooks_falhou' }) } })
  })
  await view.toggle({ label: 'Settings' })
  await view.select({ label: 'Settings sections' }, 'imposicao')
  await view.press({ type: 'Button', text: 'Reinstall' })
  assert.equal(view.find({ text: /^x$/ }), null)
  assert.ok(view.find({ text: /Could not change/ }))
})

test('en: códigos de hook e do orca embutidos na mensagem saem em inglês, sem português', async () => {
  view = await mount(panel, {
    locale: 'en',
    host: hostCom(estadoReal(), { 'hooks.estado': () => [{ agente: 'claude', estado: 'ausente' }], 'hooks.reinstalar': () => { throw Object.assign(new Error('/c/settings.json: raiz_invalida; orca_saiu:3'), { code: 'hooks_falhou' }) } })
  })
  await view.toggle({ label: 'Settings' })
  await view.select({ label: 'Settings sections' }, 'imposicao')
  await view.press({ type: 'Button', text: 'Reinstall' })
  assert.ok(view.find({ text: /root is not an object.*orca exited with code 3/ }))
  assert.equal(view.find({ text: /raiz|saiu|inválid/ }), null)
})

test('en: recusa da config e erro de medida saem traduzidos, sem o código cru', async () => {
  const e = estadoReal({ medidas: [medida('alfa', { estado: 'erro', erro: 'claude_usage_unavailable' })] })
  view = await mount(panel, { locale: 'en', host: hostCom(e) })
  assert.equal(view.find({ text: /claude_usage_unavailable/ }), null)
  assert.ok(view.find({ type: 'Callout', text: /usage unavailable/ }))
})

test('cota exatamente no limite (80%) mostra o alerta no painel, pela regra do worker', async () => {
  const e = estadoReal({ medidas: [medida('alfa', { estado: 'ok', curta: 80, longa: 10 })] })
  view = await mount(panel, { locale: 'pt-BR', host: hostCom(e) })
  assert.ok(view.find({ type: 'Table', label: 'Contas do pool', text: /⚠ 80%/ }))
  assert.equal(view.find({ type: 'Table', label: 'Contas do pool', text: /⚠ 10%/ }), null)
})

test('fila por banco: Postgres também aparece como banco', async () => {
  const e = estadoReal()
  e.fila.modo = 'banco'
  e.fila.testes = [{ pid: 1, estado: 'execucao', recurso: 'postgres 127.0.0.1:5432/app', worktree: '/w/a', projeto: 'a', comando: 'x', fila: null, desde_ts: 1 }]
  view = await mount(panel, { locale: 'pt-BR', host: hostCom(e) })
  assert.ok(view.find({ type: 'Table', label: 'Testes na fila', text: /Banco 127\.0\.0\.1:5432\/app/ }))
})

test('conta detectada pelo Orca só tem "Não utilizar"; a manual também pode ser removida', async () => {
  const e = estadoReal({ contas: [conta('auto', { origem: 'orca' }), conta('manual')] })
  view = await mount(panel, { locale: 'pt-BR', host: hostCom(e) })
  await view.toggle({ label: 'Configurações' })
  await view.select({ label: 'Assuntos das configurações' }, 'contas')
  await view.select({ label: 'Conta a configurar' }, 'auto')
  assert.ok(view.find({ type: 'Checkbox', label: 'Não utilizar' }))
  assert.equal(view.find({ text: 'Remover do pool' }), null)
  await view.select({ label: 'Conta a configurar' }, 'manual')
  assert.ok(view.find({ text: 'Remover do pool' }))
})

test('conta ilimitada (vagas 0) com ocupação aparece como N/∞', async () => {
  const e = estadoReal({ contas: [conta('livre', { vagas: 0 })] })
  e.pool.contas[0].usadas = 2
  view = await mount(panel, { locale: 'pt-BR', host: hostCom(e) })
  assert.ok(view.find({ type: 'Table', label: 'Contas do pool', text: /2\/∞/ }))
})

for (const [locale, tabela] of [['pt-BR', 'Contas do pool'], ['en', 'Pool accounts']] as const) {
  test(`${locale}: detalhes da conta listam um item por limite separado, com o nome na primeira coluna e os valores em 5h e Semanal`, async () => {
    const limites = [{ nome: 'Gemini Models', curta: 0, longa: 0 }, { nome: 'Gemini 4 Argon', curta: null, longa: 53 }]
    const e = estadoReal({ medidas: [medida('alfa', { estado: 'ok', curta: 0, longa: 0, limites }), medida('beta', { estado: 'ok', curta: 1, longa: 1 })] })
    view = await mount(panel, { locale, host: hostCom(e) })
    await view.selectRows({ label: tabela }, ['alfa'])
    const linhas = view.find({ type: 'Table', label: tabela })!.props.rows as { key: string; cells: Record<string, unknown> }[]
    const limite = (nome: string) => linhas.find((l) => l.key.includes('#') && l.cells.conta === nome)?.cells
    assert.deepEqual([limite('Gemini Models')?.h5, limite('Gemini Models')?.semanal], ['0%', '0%'])
    assert.deepEqual([limite('Gemini 4 Argon')?.h5, limite('Gemini 4 Argon')?.semanal], ['–', '53%'])
    assert.equal(view.find({ type: 'Table', label: tabela, text: /semana 53|week 53/ }), null) // sem o texto antigo '5h X · semana Y'
    await view.selectRows({ label: tabela }, ['alfa'])
    await view.selectRows({ label: tabela }, ['beta'])
    assert.equal(view.find({ type: 'Table', label: tabela, text: /Gemini Models/ }), null)
  })
}

for (const [locale, tabela, pasta, cli] of [
  ['pt-BR', 'Contas do pool', /Situação.*não configurada nesta máquina: pasta C:\\h\\\.claude-team não existe/, /Situação.*não configurada nesta máquina: codex não instalado/],
  ['en', 'Pool accounts', /Status.*not set up on this machine: folder C:\\h\\\.claude-team does not exist/, /Status.*not set up on this machine: codex not installed/]
] as const) {
  test(`${locale}: conta não configurada tem – na linha, Situação com o motivo e nenhum bloco Atenção`, async () => {
    const e = estadoReal({ orca: { rodando: true, versao: null }, medidas: [medida('alfa', { estado: 'nao_configurada', erro: 'pasta_ausente:C:\\h\\.claude-team' }), medida('beta', { estado: 'nao_configurada', erro: 'cli_ausente:codex' })] })
    view = await mount(panel, { locale, host: hostCom(e) })
    assert.equal(view.find({ type: 'Callout', text: /Atenção|Attention/ }), null)
    const linhas = view.find({ type: 'Table', label: tabela })!.props.rows as { key: string; cells: Record<string, unknown> }[]
    assert.deepEqual(linhas.map((l) => [l.cells.h5, l.cells.semanal]), [['–', '–'], ['–', '–']])
    await view.selectRows({ label: tabela }, ['alfa'])
    assert.ok(view.find({ type: 'Table', label: tabela, text: pasta }))
    await view.selectRows({ label: tabela }, ['alfa'])
    await view.selectRows({ label: tabela }, ['beta'])
    assert.ok(view.find({ type: 'Table', label: tabela, text: cli }))
    assert.equal(view.find({ type: 'Table', label: tabela, text: /⚠/ }), null)
  })
}
