import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'node:test'
import { afterEach, assert, mountWorker as montarWorker, test } from 'orca/testing'
import { guardarCasaReal } from '../../test/helpers/casa.ts'
import * as main from './main.ts'
import { criarCiclo, intervaloMs } from './ciclo.ts'
import { versao } from '../core/index.ts'
import { criarRequisitos, versaoAtende } from './requisitos.ts'

guardarCasaReal()
const ENV = ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'PATH', 'Path', 'ORCA_CMD', 'ORCA_CLI_COMMAND'] as const
const original = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
let casa = ''

// Casa isolada, PATH vazio (nenhum agente detectado) e um "Orca" que é o próprio node: `--version` responde e o resto falha.
function novaCasa(): string {
  casa = mkdtempSync(join(tmpdir(), 'pool-worker-'))
  process.env.HOME = process.env.USERPROFILE = casa
  delete process.env.HOMEDRIVE
  delete process.env.HOMEPATH
  assert.equal(homedir(), casa, 'Node deve resolver a casa isolada antes de ativar instaladores')
  process.env.PATH = process.env.Path = join(casa, 'vazio')
  process.env.ORCA_CMD = process.execPath
  delete process.env.ORCA_CLI_COMMAND
  return casa
}

afterEach(() => {
  main.deactivate()
  for (const k of ENV) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
  if (casa) rmSync(casa, { recursive: true, force: true })
})

async function ate(condicao: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condicao(); i++) await new Promise((r) => setTimeout(r, 50))
}

// A ativação termina com dois estado.mudou (depois da config e depois dos instaladores).
const ativado = (w: { posts: readonly unknown[] }) => ate(() => w.posts.length >= 2)

async function mountWorker(modulo: typeof main) {
  const w = await montarWorker(modulo)
  await ativado(w)
  assert.ok(w.posts.length >= 2, 'ativação terminou antes de restaurar o ambiente')
  return w
}

const raizDados = () => join(casa, '.agents', 'agent-pool')
const gravarConfig = (obj: unknown) => {
  mkdirSync(raizDados(), { recursive: true })
  writeFileSync(join(raizDados(), 'config.json'), JSON.stringify(obj, null, 2))
}
const conta = (nome: string, agente = 'claude') => ({ nome, agente, config: null, comando: null, vagas: 2, peso: 1, papeis: ['escritor'], ativo: true, origem: 'manual' })
const config = (contas: unknown[] = []) => ({
  versao: 1,
  pool: { teto: 0, ramMinGb: 0, escolha: 'ritmo', contas },
  fila: { modo: 'banco', vagas: 2, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 300 }
})

test('estado.ler sem config devolve o padrão, sem contas e com a versão do plugin', async () => {
  novaCasa()
  const w = await mountWorker(main)
  const e = await w.request('estado.ler')
  assert.equal(e.saude.plugin_versao, versao)
  assert.deepEqual(e.pool.contas, [])
  assert.equal(e.fila.modo, 'banco')
  assert.equal(e.fila.config.vagas, 2)
  assert.deepEqual(w.refusals, [])
  await w.deactivate()
})

test('estado.ler junta conta, vaga ocupada e teste da fila', async () => {
  novaCasa()
  gravarConfig(config([conta('alfa')]))
  const vaga = join(raizDados(), 'state', 'vagas', 'alfa.lock1')
  mkdirSync(vaga, { recursive: true })
  writeFileSync(join(vaga, 'dispatch'), 'ctx_1')
  writeFileSync(join(vaga, 'desde'), String(Date.now()))
  const w = await mountWorker(main)
  const e = await w.request('estado.ler')
  assert.equal(e.pool.contas[0].usadas, 1)
  assert.equal(e.pool.contas[0].ocupantes[0].dispatch, 'ctx_1')
  assert.equal(e.pool.maquina.usadas, 1)
  await w.deactivate()
})

test('config.gravar grava e devolve o estado; valor inválido e config corrompida são config_recusada sem tocar no arquivo', async () => {
  novaCasa()
  gravarConfig(config())
  const w = await mountWorker(main)
  const e = await w.request('config.gravar', { valores: { 'fila.vagas': '4' } })
  assert.equal(e.fila.vagas, 4)
  assert.equal(JSON.parse(readFileSync(join(raizDados(), 'config.json'), 'utf8')).fila.vagas, 4)

  await assert.rejects(w.request('config.gravar', { valores: { 'fila.vagas': '0' } }), (x: unknown) => (x as { code?: string }).code === 'config_recusada')
  assert.equal(JSON.parse(readFileSync(join(raizDados(), 'config.json'), 'utf8')).fila.vagas, 4)

  writeFileSync(join(raizDados(), 'config.json'), '{ quebrado')
  await assert.rejects(w.request('config.gravar', { valores: { 'fila.vagas': '3' } }), (x: unknown) => (x as { code?: string }).code === 'config_recusada')
  assert.equal(readFileSync(join(raizDados(), 'config.json'), 'utf8'), '{ quebrado')
  const lido = await w.request('estado.ler')
  assert.equal(lido.alertas.some((a) => a.codigo === 'config_ilegivel' && a.nivel === 'erro'), true)
  await w.deactivate()
})

test('ativação importa o agentes.conf legado na primeira vez e não altera o original', async () => {
  novaCasa()
  mkdirSync(join(casa, '.claude'), { recursive: true })
  copyFileSync(join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'agentes.conf'), join(casa, '.claude', 'agentes.conf'))
  const antes = readFileSync(join(casa, '.claude', 'agentes.conf'), 'utf8')
  const w = await mountWorker(main)
  await ativado(w)
  const e = await w.request('estado.ler')
  assert.ok(e.pool.contas.length > 0)
  assert.equal(readFileSync(join(casa, '.claude', 'agentes.conf'), 'utf8'), antes)
  await w.deactivate()
})

test('requisitos.ler: Orca pela versão, orchestration não verificável, skill e lançador pendentes, hooks sem agente', async () => {
  novaCasa()
  const w = await mountWorker(main)
  await ativado(w)
  const r = await w.request('requisitos.ler')
  const por = Object.fromEntries(r.itens.map((i) => [i.id, i]))
  assert.deepEqual(Object.keys(por), ['orca', 'orchestration', 'skill', 'lancador', 'hooks'])
  assert.equal(por.orca.ok, true) // node --version
  assert.equal(por.orchestration.ok, false)
  assert.equal(por.orchestration.detalhe.codigo, 'nao_verificado')
  assert.equal(por.hooks.ok, true)
  assert.equal(r.ok, false)
  await assert.rejects(w.request('requisitos.instalar', { id: 'orca' as never }), (x: unknown) => (x as { code?: string }).code === 'instalacao_recusada')
  await w.deactivate()
})

test('hooks: estado, remover (arquivo volta ao original) e reinstalar; agente desconhecido é agente_invalido', async () => {
  novaCasa()
  mkdirSync(join(casa, '.claude'), { recursive: true })
  const original = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'x' }] }] } }, null, 2) + '\n'
  writeFileSync(join(casa, '.claude', 'settings.json'), original)
  const w = await mountWorker(main)
  await ativado(w)

  assert.deepEqual(await w.request('hooks.estado'), [
    { agente: 'claude', estado: 'ausente' },
    { agente: 'codex', estado: 'ausente' }
  ])
  const depois = await w.request('hooks.reinstalar', { agente: 'claude' })
  assert.equal(depois[0].estado, 'instalado')
  assert.notEqual(readFileSync(join(casa, '.claude', 'settings.json'), 'utf8'), original)
  assert.equal(existsSync(join(raizDados(), 'state', 'backup', 'claude-settings.json.orig')), true)

  const removido = await w.request('hooks.remover', { agente: 'claude' })
  assert.equal(removido[0].estado, 'ausente')
  assert.equal(readFileSync(join(casa, '.claude', 'settings.json'), 'utf8'), original)

  for (const m of ['hooks.remover', 'hooks.reinstalar'] as const) {
    await assert.rejects(w.request(m, { agente: 'gemini' }), (x: unknown) => (x as { code?: string }).code === 'agente_invalido')
  }
  await w.deactivate()
})

test('requisitos.instalar hooks não reinstala o hook que o usuário removeu', async () => {
  novaCasa()
  gravarConfig(config([conta('a'), conta('b', 'codex')]))
  const w = await mountWorker(main)
  await w.request('hooks.remover', { agente: 'claude' })
  rmSync(join(casa, '.codex', 'hooks.json')) // codex perde o hook por fora, sem marca de removido
  await w.request('requisitos.instalar', { id: 'hooks' })
  const estado = Object.fromEntries((await w.request('hooks.estado')).map((h) => [h.agente, h.estado]))
  assert.equal(estado.claude, 'ausente')
  assert.equal(estado.codex, 'instalado')
  await w.deactivate()
})

test('conta com pasta de config própria recebe hook e skill na pasta dela; remover devolve o original; link não duplica', async () => {
  novaCasa()
  const pasta = join(casa, '.claude-work')
  mkdirSync(pasta, { recursive: true })
  const original = JSON.stringify({ model: 'x' }, null, 2) + '\n'
  writeFileSync(join(pasta, 'settings.json'), original)
  // .claude-c guarda as skills por link para as da pasta padrão (a "skills" já aponta para o mesmo lugar).
  mkdirSync(join(casa, '.claude', 'skills'), { recursive: true })
  mkdirSync(join(casa, '.claude-c'), { recursive: true })
  symlinkSync(join(casa, '.claude', 'skills'), join(casa, '.claude-c', 'skills'), 'junction')
  gravarConfig(config([{ ...conta('b'), config: '~/.claude-work' }, { ...conta('c'), config: '~/.claude-c' }]))
  const w = await mountWorker(main)
  const hook = (f: string) => JSON.stringify(JSON.parse(readFileSync(f, 'utf8')).hooks?.PreToolUse ?? [])
  assert.match(hook(join(pasta, 'settings.json')), /agent-pool/)
  assert.match(hook(join(casa, '.claude', 'settings.json')), /agent-pool/)
  assert.equal(existsSync(join(pasta, 'skills', 'agent-pool')), true)
  assert.equal(existsSync(join(casa, '.claude', 'skills', 'agent-pool')), true) // a de .claude-c é a mesma, sem duplicar
  assert.equal((await w.request('hooks.estado'))[0].estado, 'instalado')

  const r = await w.request('hooks.remover', { agente: 'claude' })
  assert.equal(r[0].estado, 'ausente')
  assert.equal(readFileSync(join(pasta, 'settings.json'), 'utf8'), original)

  await w.request('hooks.reinstalar', { agente: 'claude' })
  writeFileSync(join(pasta, 'settings.json'), original) // só a pasta da conta perde o hook por fora
  assert.equal((await w.request('hooks.estado'))[0].estado, 'ausente')
  const req = await w.request('requisitos.ler')
  assert.equal(req.itens.find((i) => i.id === 'hooks')?.ok, false)
  await w.deactivate()
})

test('remover imposição alcança a conta desativada; config ilegível recusa em vez de remover pela metade', async () => {
  novaCasa()
  const pasta = join(casa, '.claude-work')
  mkdirSync(pasta, { recursive: true })
  const original = JSON.stringify({ model: 'x' }, null, 2) + '\n'
  writeFileSync(join(pasta, 'settings.json'), original)
  gravarConfig(config([{ ...conta('w'), config: '~/.claude-work' }]))
  const w = await mountWorker(main)
  assert.match(readFileSync(join(pasta, 'settings.json'), 'utf8'), /agent-pool/)
  await w.request('config.gravar', { valores: { 'conta.w.ativo': 'nao' } })
  await w.request('hooks.remover', { agente: 'claude' })
  assert.equal(readFileSync(join(pasta, 'settings.json'), 'utf8'), original)

  writeFileSync(join(raizDados(), 'config.json'), '{ quebrado')
  await assert.rejects(w.request('hooks.remover', { agente: 'claude' }), (x: unknown) => (x as { code?: string }).code === 'config_recusada')
  await w.deactivate()
})

test('apagar conta pelo painel tira hook e link da skill da pasta dela e preserva a pasta padrão', async () => {
  novaCasa()
  const pasta = join(casa, '.claude-gone')
  mkdirSync(pasta, { recursive: true })
  const original = JSON.stringify({ model: 'x' }, null, 2) + '\n'
  writeFileSync(join(pasta, 'settings.json'), original)
  gravarConfig(config([conta('a'), { ...conta('g'), config: '~/.claude-gone' }]))
  const w = await mountWorker(main)
  assert.match(readFileSync(join(pasta, 'settings.json'), 'utf8'), /agent-pool/)
  assert.equal(existsSync(join(pasta, 'skills', 'agent-pool')), true)

  await w.request('config.gravar', { valores: { 'conta.g.remover': '1' } })
  assert.equal(readFileSync(join(pasta, 'settings.json'), 'utf8'), original)
  assert.equal(existsSync(join(pasta, 'skills', 'agent-pool')), false)
  assert.match(readFileSync(join(casa, '.claude', 'settings.json'), 'utf8'), /agent-pool/) // a conta que ficou segue com hook
  assert.equal(existsSync(join(casa, '.claude', 'skills', 'agent-pool')), true)
  await w.deactivate()
})

test('pasta de conta que não existe não é criada; conta nova pelo painel recebe hook e skill na hora', async () => {
  novaCasa()
  const sumida = join(casa, '.claude-typo')
  gravarConfig(config([{ ...conta('t'), config: '~/.claude-typo' }]))
  const w = await mountWorker(main)
  assert.equal(existsSync(sumida), false)

  const nova = join(casa, '.claude-new')
  mkdirSync(nova, { recursive: true })
  await w.request('config.gravar', { valores: { 'conta.n.adicionar': 'claude', 'conta.n.config': '~/.claude-new' } })
  assert.equal(existsSync(join(nova, 'skills', 'agent-pool')), true)
  assert.match(readFileSync(join(nova, 'settings.json'), 'utf8'), /agent-pool/)
  await w.deactivate()
})

test('conta nova: falha síncrona na cópia da skill não impede o hook nem rejeita o config.gravar', async () => {
  novaCasa()
  gravarConfig(config())
  const w = await mountWorker(main)
  await ativado(w)
  const skills = join(casa, '.agents', 'skills')
  rmSync(skills, { recursive: true, force: true })
  writeFileSync(skills, 'arquivo no lugar da pasta')
  const nova = join(casa, '.claude-new')
  mkdirSync(nova, { recursive: true })
  await w.request('config.gravar', { valores: { 'conta.n.adicionar': 'claude', 'conta.n.config': '~/.claude-new' } })
  assert.match(readFileSync(join(nova, 'settings.json'), 'utf8'), /agent-pool/)
  await w.deactivate()
})

test('config.gravar recusado manda `chave: codigo` para o painel traduzir', async () => {
  novaCasa()
  gravarConfig(config())
  const w = await mountWorker(main)
  await assert.rejects(w.request('config.gravar', { valores: { 'fila.vagas': '0' } }), (x: unknown) => (x as { message?: string }).message === 'fila.vagas: valor_invalido')
  await w.deactivate()
})

test('hooks: JSON inválido do usuário vira erro no estado e não é tocado', async () => {
  novaCasa()
  mkdirSync(join(casa, '.claude'), { recursive: true })
  writeFileSync(join(casa, '.claude', 'settings.json'), '{ nao e json')
  const w = await mountWorker(main)
  await ativado(w)
  const lista = await w.request('hooks.estado')
  assert.equal(lista[0].estado, 'erro')
  assert.ok(lista[0].detalhe)
  await assert.rejects(w.request('hooks.reinstalar', { agente: 'claude' }), (x: unknown) => (x as { code?: string }).code === 'hooks_falhou')
  assert.equal(readFileSync(join(casa, '.claude', 'settings.json'), 'utf8'), '{ nao e json')
  await w.deactivate()
})

test('mudança no estado em disco dispara um único estado.mudou por rajada', async () => {
  novaCasa()
  const w = await mountWorker(main)
  await ativado(w)
  await new Promise((r) => setTimeout(r, 500))
  const antes = w.posts.length
  mkdirSync(join(raizDados(), 'state', 'fila', 'x', '1'), { recursive: true })
  writeFileSync(join(raizDados(), 'state', 'fila', 'x', '1', 'pid'), '1')
  writeFileSync(join(raizDados(), 'state', 'fila', 'x', '1', 'inicio'), '1')
  await ate(() => w.posts.length > antes)
  await new Promise((r) => setTimeout(r, 600))
  assert.equal(w.posts.length, antes + 1)
  await w.deactivate()
})

// --- requisitos (lógica pura) ---
const depsOk = {
  orca: async (args: string[]) => (args[0] === '--version' ? '1.4.246' : JSON.stringify({ result: { skills: [{ name: 'orchestration' }] } })),
  skill: () => ({ estado: 'ok' as const }),
  lancador: () => true,
  hooks: () => [{ agente: 'claude', estado: 'instalado' as const }],
  instalar: async () => {}
}

test('requisitos: tudo certo, versão antiga, hook removido por escolha não trava e hook ausente trava', async () => {
  assert.equal((await criarRequisitos(depsOk).ler()).ok, true)
  assert.equal(versaoAtende('1.4.245'), false)
  assert.equal(versaoAtende('v1.5.0'), true)
  assert.equal(versaoAtende('sem versão'), null)
  const velha = await criarRequisitos({ ...depsOk, orca: async (a) => (a[0] === '--version' ? '1.4.100' : depsOk.orca(a)) }).ler()
  assert.equal(velha.itens[0].ok, false)
  const removido = await criarRequisitos({ ...depsOk, hooks: () => [{ agente: 'claude', estado: 'ausente' as const, removido: true }] }).ler()
  assert.equal(removido.ok, true)
  const ausente = await criarRequisitos({ ...depsOk, hooks: () => [{ agente: 'claude', estado: 'ausente' as const }] }).ler()
  assert.equal(ausente.itens.find((i) => i.id === 'hooks')?.ok, false)
  const semSkill = await criarRequisitos({ ...depsOk, skill: () => ({ estado: 'editada' as const }) }).ler()
  assert.equal(semSkill.ok, true) // skill editada é respeitada
})

test('requisitos: instalar relê o estado e guarda por 60 s', async () => {
  let t = 0
  let lancador = false
  let chamadas = 0
  const r = criarRequisitos({ ...depsOk, lancador: () => (chamadas++, lancador), instalar: async () => void (lancador = true), agora: () => t })
  assert.equal((await r.ler()).ok, false)
  await r.ler()
  assert.equal(chamadas, 1)
  t = 61_000
  await r.ler()
  assert.equal(chamadas, 2)
  assert.equal((await r.instalar('lancador')).ok, true)
  await assert.rejects(r.instalar('orca'), (e: unknown) => (e as { code?: string }).code === 'instalacao_recusada')
})

// --- ciclo ---
async function comRelogio(corpo: (r: { avancar: (ms: number) => Promise<void> }) => Promise<void>): Promise<void> {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  try {
    await corpo({
      avancar: async (ms) => {
        mock.timers.tick(ms)
        for (let i = 0; i < 5; i++) await Promise.resolve()
      }
    })
  } finally {
    mock.timers.reset()
  }
}

test('intervaloMs: padrão 60 s e limites 15–3600 s', () => {
  assert.equal(intervaloMs(undefined), 60_000)
  assert.equal(intervaloMs('x'), 60_000)
  assert.equal(intervaloMs(1), 15_000)
  assert.equal(intervaloMs(99999), 3_600_000)
})

test('ciclo: com painel aberto coleta e avisa a cada 60 s; sem painel não coleta', async () => {
  await comRelogio(async ({ avancar }) => {
    let coletas = 0
    let avisos = 0
    const c = criarCiclo({ coletar: async () => void coletas++, avisar: () => void avisos++, erro: () => {}, renovaMs: 1_000_000 })
    await avancar(300_000)
    assert.equal(coletas, 0)
    assert.equal(c.ativo(), false)
    const painel = new AbortController()
    void c.vigiar(painel.signal)
    await avancar(59_999)
    assert.equal(coletas, 0)
    await avancar(1)
    assert.deepEqual([coletas, avisos], [1, 1])
    painel.abort()
    c.parar()
  })
})

test('ciclo: coleta lenta não empilha; fechar o painel para o ciclo', async () => {
  await comRelogio(async ({ avancar }) => {
    let coletas = 0
    let termina: () => void = () => {}
    const c = criarCiclo({
      coletar: () => {
        coletas++
        return coletas === 1 ? new Promise<void>((r) => (termina = r)) : Promise.resolve()
      },
      avisar: () => {},
      erro: () => {},
      renovaMs: 1_000_000,
      gracaMs: 3_000
    })
    const painel = new AbortController()
    void c.vigiar(painel.signal)
    await avancar(60_000)
    await avancar(60_000)
    assert.equal(coletas, 1)
    termina()
    await avancar(0)
    await avancar(60_000)
    assert.equal(coletas, 2)
    painel.abort()
    await avancar(3_000)
    assert.equal(c.ativo(), false)
    await avancar(300_000)
    assert.equal(coletas, 2)
  })
})
