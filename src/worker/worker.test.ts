import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'node:test'
import { afterEach, assert, mountWorker as montarWorker, test } from 'orca/testing'
import { guardarCasaReal } from '../../test/helpers/casa.ts'
import { versao } from '../core/index.ts'
import { criarCiclo, intervaloMs } from './ciclo.ts'
import * as main from './main.ts'
import { criarRequisitos, versaoAtende } from './requisitos.ts'

guardarCasaReal()
const ENV = ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'PATH', 'Path', 'ORCA_CMD', 'ORCA_CLI_COMMAND'] as const
const original = Object.fromEntries(ENV.map(k => [k, process.env[k]]))
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
  for (let i = 0; i < 100 && !condicao(); i++) await new Promise(r => setTimeout(r, 50))
}

// A ativação termina com um estado.mudou, depois da config e da primeira coleta.
const ativado = (w: { posts: readonly unknown[] }) => ate(() => w.posts.length >= 1)

async function mountWorker(modulo: typeof main) {
  const w = await montarWorker(modulo)
  await ativado(w)
  assert.ok(w.posts.length >= 1, 'ativação terminou antes de restaurar o ambiente')
  return w
}

const raizDados = () => join(casa, '.agents', 'agent-pool')
const gravarConfig = (obj: unknown) => {
  mkdirSync(raizDados(), { recursive: true })
  writeFileSync(join(raizDados(), 'config.json'), JSON.stringify(obj, null, 2))
}
const conta = (nome: string, agente = 'claude') => ({
  nome,
  agente,
  config: null,
  comando: null,
  modelo: null,
  vagas: 2,
  peso: 1,
  papeis: ['escritor'],
  ativo: true,
  origem: 'manual',
})
const config = (contas: unknown[] = []) => ({
  versao: 1,
  pool: { teto: 0, ramMinGb: 0, escolha: 'ritmo', contas },
  fila: { modo: 'banco', vagas: 2, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 300 },
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

test('worker religado: antes da primeira coleta mostra as medidas gravadas e o Orca "verificando", sem alerta', async () => {
  novaCasa()
  gravarConfig(config([conta('alfa')]))
  const medidas = join(raizDados(), 'state', 'medidas')
  mkdirSync(medidas, { recursive: true })
  writeFileSync(
    join(medidas, 'contas.json'),
    JSON.stringify({ x: { conta: 'alfa', curta: 10, longa: 20, resetLongaTs: null, estado: 'ok', medidaTs: Date.now() - 40 * 60_000 } }),
  )
  // A coleta da ativação fica presa no fetch da API de uso até o fim das asserções: sem corrida com o pedido.
  mkdirSync(join(casa, '.claude'))
  writeFileSync(
    join(casa, '.claude', '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'falso', expiresAt: 9_999_999_999_999 } }),
  )
  let soltar = () => {}
  const liberado = new Promise<void>(r => {
    soltar = r
  })
  // Solta com uso válido: a coleta fecha pela API, sem lançar o claude real.
  const preso = mock.method(globalThis, 'fetch', async () => {
    await liberado
    return Response.json({ five_hour: { utilization: 1 }, seven_day: { utilization: 2 } })
  })
  try {
    const w = await montarWorker(main)
    const e = await w.request('estado.ler')
    assert.equal(e.pool.contas[0].cota?.estado, 'antiga')
    assert.equal(e.pool.contas[0].cota?.curta, 10)
    assert.equal(e.saude.orca.rodando, null)
    assert.equal(
      e.alertas.some((a: { codigo: string }) => a.codigo === 'orca_indisponivel'),
      false,
    )
    soltar()
    await ativado(w)
    assert.ok(w.posts.length >= 1, 'ativação terminou')
    await w.deactivate()
  } finally {
    soltar()
    preso.mock.restore()
  }
})

test('cotas.medir mede de novo mesmo com a medida da ativação ainda no cache', async () => {
  casaComCredencial()
  let uso = 0
  const api = mock.method(globalThis, 'fetch', async () => {
    uso++
    return Response.json({ five_hour: { utilization: uso }, seven_day: { utilization: 50 } })
  })
  try {
    const w = await mountWorker(main)
    assert.equal(api.mock.callCount(), 1)
    assert.equal((await w.request('estado.ler')).pool.contas[0].cota?.curta, 1)
    const e = await w.request('cotas.medir')
    assert.equal(api.mock.callCount(), 2)
    assert.equal(e.pool.contas[0].cota?.curta, 2)
    await w.deactivate()
  } finally {
    api.mock.restore()
  }
})

/** Conta `alfa` com credencial: a medição passa pelo fetch da API de uso (sem lançar o claude real). */
function casaComCredencial() {
  novaCasa()
  gravarConfig(config([conta('alfa')]))
  mkdirSync(join(casa, '.claude'))
  writeFileSync(
    join(casa, '.claude', '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'falso', expiresAt: 9_999_999_999_999 } }),
  )
}

test('cotas.medir durante a coleta da ativação espera ela e mede de novo, sem o cache', async () => {
  casaComCredencial()
  let soltar = () => {}
  const liberado = new Promise<void>(r => (soltar = r))
  let uso = 0
  const api = mock.method(globalThis, 'fetch', async () => {
    const n = ++uso
    if (n === 1) await liberado // a coleta da ativação fica presa até o pedido chegar
    return Response.json({ five_hour: { utilization: n }, seven_day: { utilization: 50 } })
  })
  try {
    const w = await montarWorker(main)
    await ate(() => api.mock.callCount() > 0)
    const pedido = w.request('cotas.medir')
    await new Promise(r => setTimeout(r, 50))
    soltar()
    const e = await pedido
    assert.equal(api.mock.callCount(), 2)
    assert.equal(e.pool.contas[0].cota?.curta, 2)
    await w.deactivate()
  } finally {
    soltar()
    api.mock.restore()
  }
})

test('cotas.medir repetido com uma medição forçada em curso espera a mesma, sem medir de novo', async () => {
  casaComCredencial()
  let soltar = () => {}
  const liberado = new Promise<void>(r => (soltar = r))
  let uso = 0
  const api = mock.method(globalThis, 'fetch', async () => {
    const n = ++uso
    if (n === 2) await liberado // a primeira medição forçada fica presa
    return Response.json({ five_hour: { utilization: n }, seven_day: { utilization: 50 } })
  })
  try {
    const w = await mountWorker(main)
    const primeiro = w.request('cotas.medir')
    await ate(() => api.mock.callCount() >= 2)
    const segundo = w.request('cotas.medir')
    await new Promise(r => setTimeout(r, 50))
    soltar()
    const [a, b] = await Promise.all([primeiro, segundo])
    assert.equal(api.mock.callCount(), 2)
    assert.equal(a.pool.contas[0].cota?.curta, 2)
    assert.equal(b.pool.contas[0].cota?.curta, 2)
    await w.deactivate()
  } finally {
    soltar()
    api.mock.restore()
  }
})

test('config.gravar grava e devolve o estado; valor inválido e config corrompida são config_recusada sem tocar no arquivo', async () => {
  novaCasa()
  gravarConfig(config())
  const w = await mountWorker(main)
  const e = await w.request('config.gravar', { valores: { 'fila.vagas': '4' } })
  assert.equal(e.fila.vagas, 4)
  assert.equal(JSON.parse(readFileSync(join(raizDados(), 'config.json'), 'utf8')).fila.vagas, 4)

  await assert.rejects(
    w.request('config.gravar', { valores: { 'fila.vagas': '0' } }),
    (x: unknown) => (x as { code?: string }).code === 'config_recusada',
  )
  assert.equal(JSON.parse(readFileSync(join(raizDados(), 'config.json'), 'utf8')).fila.vagas, 4)

  writeFileSync(join(raizDados(), 'config.json'), '{ quebrado')
  await assert.rejects(
    w.request('config.gravar', { valores: { 'fila.vagas': '3' } }),
    (x: unknown) => (x as { code?: string }).code === 'config_recusada',
  )
  assert.equal(readFileSync(join(raizDados(), 'config.json'), 'utf8'), '{ quebrado')
  const lido = await w.request('estado.ler')
  assert.equal(
    lido.alertas.some(a => a.codigo === 'config_ilegivel' && a.nivel === 'erro'),
    true,
  )
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
  const por = Object.fromEntries(r.itens.map(i => [i.id, i]))
  assert.deepEqual(Object.keys(por), ['orca', 'orchestration', 'skill', 'lancador', 'hooks'])
  assert.equal(por.orca.ok, true) // node --version
  assert.equal(por.orchestration.ok, false)
  assert.equal(por.orchestration.detalhe.codigo, 'nao_verificado')
  assert.equal(por.hooks.ok, true)
  assert.equal(r.ok, false)
  await assert.rejects(
    w.request('requisitos.instalar', { id: 'orca' as never }),
    (x: unknown) => (x as { code?: string }).code === 'instalacao_recusada',
  )
  await w.deactivate()
})

test('requisitos.instalar que falha registra o id e o erro no log do plugin e relança', async () => {
  novaCasa()
  const w = await mountWorker(main)
  await assert.rejects(
    w.request('requisitos.instalar', { id: 'orchestration' }),
    (x: unknown) => (x as { code?: string }).code === 'instalacao_falhou',
  )
  assert.ok(
    w.logs.some(l => /requisitos\.instalar orchestration: /.test(l) && l.length > 'requisitos.instalar orchestration: '.length),
    w.logs.join('\n'),
  )
  await w.deactivate()
})

test('hooks: estado, remover (arquivo volta ao original) e reinstalar; agente desconhecido é agente_invalido', async () => {
  novaCasa()
  mkdirSync(join(casa, '.claude'), { recursive: true })
  const original = `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'x' }] }] } }, null, 2)}\n`
  writeFileSync(join(casa, '.claude', 'settings.json'), original)
  const w = await mountWorker(main)
  await ativado(w)

  assert.deepEqual(await w.request('hooks.estado'), [
    { agente: 'claude', estado: 'ausente', arquivos: [join('~', '.claude', 'settings.json')] },
    { agente: 'codex', estado: 'ausente', arquivos: [join('~', '.codex', 'hooks.json')] },
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

test('ativação não grava nada fora de ~/.agents/agent-pool: lançador, skill e hooks só saem do clique', async () => {
  novaCasa()
  const pasta = join(casa, '.claude-work')
  mkdirSync(pasta, { recursive: true })
  const original = `${JSON.stringify({ model: 'x' }, null, 2)}\n`
  writeFileSync(join(pasta, 'settings.json'), original)
  gravarConfig(config([conta('a'), { ...conta('w'), config: '~/.claude-work' }, conta('b', 'codex')]))
  const w = await mountWorker(main)
  assert.equal(readFileSync(join(pasta, 'settings.json'), 'utf8'), original)
  for (const f of [
    join('.agents', 'bin'),
    join('.agents', 'skills'),
    join('.claude', 'settings.json'),
    join('.claude', 'skills'),
    join('.codex'),
    join('.claude-work', 'skills'),
  ]) {
    assert.equal(existsSync(join(casa, f)), false, f)
  }
  const r = await w.request('requisitos.ler')
  const por = Object.fromEntries(r.itens.map(i => [i.id, i]))
  assert.equal(r.ok, false)
  assert.deepEqual(por.hooks.arquivos, [
    join('~', '.claude', 'settings.json'),
    join('~', '.claude-work', 'settings.json'),
    join('~', '.codex', 'hooks.json'),
  ])
  assert.deepEqual(
    por.lancador.arquivos?.map(f => f.split(/[\\/]/).pop()),
    process.platform === 'win32' ? ['agent-pool', 'agent-pool.cmd'] : ['agent-pool'],
  )
  assert.ok(por.skill.arquivos?.includes(join('~', '.agents', 'skills', 'agent-pool')))
  assert.ok(por.skill.arquivos?.includes(join('~', '.claude-work', 'skills', 'agent-pool')))
  await w.deactivate()
})

test('remover hook volta a travar os requisitos; instalar pelos requisitos põe em todos os agentes das contas', async () => {
  novaCasa()
  gravarConfig(config([conta('a'), conta('b', 'codex')]))
  const w = await mountWorker(main)
  await w.request('requisitos.instalar', { id: 'hooks' })
  assert.equal((await w.request('requisitos.ler', { forcar: true })).itens.find(i => i.id === 'hooks')?.ok, true)
  await w.request('hooks.remover', { agente: 'claude' })
  const hooks = (await w.request('requisitos.ler')).itens.find(i => i.id === 'hooks')!
  assert.equal(hooks.ok, false)
  assert.deepEqual(hooks.arquivos, [join('~', '.claude', 'settings.json')])
  await w.request('requisitos.instalar', { id: 'hooks' })
  const estado = Object.fromEntries((await w.request('hooks.estado')).map(h => [h.agente, h.estado]))
  assert.deepEqual(estado, { claude: 'instalado', codex: 'instalado' })
  await w.deactivate()
})

test('conta com pasta de config própria recebe hook e skill na pasta dela pelo clique; remover devolve o original; link não duplica', async () => {
  novaCasa()
  const pasta = join(casa, '.claude-work')
  mkdirSync(pasta, { recursive: true })
  const original = `${JSON.stringify({ model: 'x' }, null, 2)}\n`
  writeFileSync(join(pasta, 'settings.json'), original)
  // .claude-c guarda as skills por link para as da pasta padrão (a "skills" já aponta para o mesmo lugar).
  mkdirSync(join(casa, '.claude', 'skills'), { recursive: true })
  mkdirSync(join(casa, '.claude-c'), { recursive: true })
  symlinkSync(join(casa, '.claude', 'skills'), join(casa, '.claude-c', 'skills'), 'junction')
  gravarConfig(
    config([
      { ...conta('b'), config: '~/.claude-work' },
      { ...conta('c'), config: '~/.claude-c' },
    ]),
  )
  const w = await mountWorker(main)
  await w.request('requisitos.instalar', { id: 'skill' })
  await w.request('requisitos.instalar', { id: 'hooks' })
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
  assert.equal(req.itens.find(i => i.id === 'hooks')?.ok, false)
  await w.deactivate()
})

test('remover hook alcança a conta desativada; config ilegível recusa em vez de remover pela metade', async () => {
  novaCasa()
  const pasta = join(casa, '.claude-work')
  mkdirSync(pasta, { recursive: true })
  const original = `${JSON.stringify({ model: 'x' }, null, 2)}\n`
  writeFileSync(join(pasta, 'settings.json'), original)
  gravarConfig(config([{ ...conta('w'), config: '~/.claude-work' }]))
  const w = await mountWorker(main)
  await w.request('requisitos.instalar', { id: 'hooks' })
  assert.match(readFileSync(join(pasta, 'settings.json'), 'utf8'), /agent-pool/)
  await w.request('config.gravar', { valores: { 'conta.w.ativo': 'nao' } })
  await w.request('hooks.remover', { agente: 'claude' })
  assert.equal(readFileSync(join(pasta, 'settings.json'), 'utf8'), original)

  writeFileSync(join(raizDados(), 'config.json'), '{ quebrado')
  await assert.rejects(
    w.request('hooks.remover', { agente: 'claude' }),
    (x: unknown) => (x as { code?: string }).code === 'config_recusada',
  )
  await w.deactivate()
})

test('apagar conta pelo painel tira hook e link da skill da pasta dela e preserva a pasta padrão', async () => {
  novaCasa()
  const pasta = join(casa, '.claude-gone')
  mkdirSync(pasta, { recursive: true })
  const original = `${JSON.stringify({ model: 'x' }, null, 2)}\n`
  writeFileSync(join(pasta, 'settings.json'), original)
  gravarConfig(config([conta('a'), { ...conta('g'), config: '~/.claude-gone' }]))
  const w = await mountWorker(main)
  await w.request('requisitos.instalar', { id: 'skill' })
  await w.request('requisitos.instalar', { id: 'hooks' })
  assert.match(readFileSync(join(pasta, 'settings.json'), 'utf8'), /agent-pool/)
  assert.equal(existsSync(join(pasta, 'skills', 'agent-pool')), true)

  await w.request('config.gravar', { valores: { 'conta.g.remover': '1' } })
  assert.equal(readFileSync(join(pasta, 'settings.json'), 'utf8'), original)
  assert.equal(existsSync(join(pasta, 'skills', 'agent-pool')), false)
  assert.match(readFileSync(join(casa, '.claude', 'settings.json'), 'utf8'), /agent-pool/) // a conta que ficou segue com hook
  assert.equal(existsSync(join(casa, '.claude', 'skills', 'agent-pool')), true)
  await w.deactivate()
})

test('pasta de conta que não existe não é criada; conta nova pelo painel não recebe nada e os requisitos voltam a pedir skill e hook', async () => {
  novaCasa()
  const sumida = join(casa, '.claude-typo')
  gravarConfig(config([{ ...conta('t'), config: '~/.claude-typo' }]))
  const w = await mountWorker(main)
  for (const id of ['lancador', 'skill', 'hooks'] as const) await w.request('requisitos.instalar', { id })
  assert.equal(existsSync(sumida), false)
  assert.equal(
    (await w.request('requisitos.ler', { forcar: true })).itens.filter(i => i.id !== 'orca' && i.id !== 'orchestration').every(i => i.ok),
    true,
  )

  const nova = join(casa, '.claude-new')
  mkdirSync(nova, { recursive: true })
  await w.request('config.gravar', { valores: { 'conta.n.adicionar': 'claude', 'conta.n.config': '~/.claude-new' } })
  assert.equal(existsSync(join(nova, 'skills')), false)
  assert.equal(existsSync(join(nova, 'settings.json')), false)
  const por = Object.fromEntries((await w.request('requisitos.ler')).itens.map(i => [i.id, i]))
  assert.equal(por.skill.ok, false)
  assert.deepEqual(por.skill.arquivos, [join('~', '.claude-new', 'skills', 'agent-pool')])
  assert.equal(por.hooks.ok, false)
  assert.deepEqual(por.hooks.arquivos, [join('~', '.claude-new', 'settings.json')])
  await w.deactivate()
})

test('desinstalar tira hooks, skill, lançador e ~/.agents/agent-pool, devolvendo os arquivos dos agentes ao original', async () => {
  novaCasa()
  const pasta = join(casa, '.claude-work')
  mkdirSync(pasta, { recursive: true })
  const original = `${JSON.stringify({ model: 'x' }, null, 2)}\n`
  writeFileSync(join(pasta, 'settings.json'), original)
  gravarConfig(config([conta('a'), { ...conta('w'), config: '~/.claude-work' }, conta('b', 'codex')]))
  const w = await mountWorker(main)
  for (const id of ['lancador', 'skill', 'hooks'] as const) await w.request('requisitos.instalar', { id })
  assert.match(readFileSync(join(pasta, 'settings.json'), 'utf8'), /agent-pool/)
  await w.request('config.gravar', { valores: { 'conta.w.ativo': 'nao' } }) // a remoção alcança a conta desativada

  assert.deepEqual(await w.request('desinstalar'), { ok: true })
  assert.equal(readFileSync(join(pasta, 'settings.json'), 'utf8'), original)
  // Arquivos que o próprio clique criou (a casa não os tinha) saem inteiros.
  assert.equal(existsSync(join(casa, '.claude', 'settings.json')), false)
  assert.equal(existsSync(join(casa, '.codex', 'hooks.json')), false)
  for (const f of [
    join('.agents', 'agent-pool'),
    join('.agents', 'skills', 'agent-pool'),
    join('.agents', 'bin', 'agent-pool'),
    join('.agents', 'bin', 'agent-pool.cmd'),
    join('.claude', 'skills', 'agent-pool'),
    join('.codex', 'skills', 'agent-pool'),
    join('.claude-work', 'skills', 'agent-pool'),
  ]) {
    assert.equal(existsSync(join(casa, f)), false, f)
  }
  await w.request('estado.ler') // o painel continua lendo, sem recriar a config
  assert.equal(existsSync(join(raizDados(), 'config.json')), false)
  await w.deactivate()
})

test('desinstalar com coleta em curso espera o fim dela e não deixa ~/.agents/agent-pool recriado', async () => {
  novaCasa()
  gravarConfig(config([conta('alfa')]))
  mkdirSync(join(casa, '.claude'))
  writeFileSync(
    join(casa, '.claude', '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'falso', expiresAt: 9_999_999_999_999 } }),
  )
  let soltar = () => {}
  const liberado = new Promise<void>(r => {
    soltar = r
  })
  const preso = mock.method(globalThis, 'fetch', async () => {
    await liberado
    return Response.json({ five_hour: { utilization: 1 }, seven_day: { utilization: 2 } })
  })
  try {
    const w = await montarWorker(main)
    await ate(() => preso.mock.callCount() > 0) // a coleta da ativação chegou ao fetch e fica presa nele
    assert.ok(preso.mock.callCount() > 0, 'coleta presa no fetch')
    const saindo = w.request('desinstalar')
    const antes = await Promise.race([saindo, new Promise(r => setTimeout(() => r('esperando'), 150))])
    assert.equal(antes, 'esperando', 'desinstalar espera a coleta em curso')
    soltar()
    assert.deepEqual(await saindo, { ok: true })
    assert.equal(existsSync(raizDados()), false)
    await w.deactivate()
  } finally {
    soltar()
    preso.mock.restore()
  }
})

test('apagar conta não tira hook nem link de pasta que outra conta ainda usa, mesmo escrita de outro jeito ou sendo a padrão', async () => {
  novaCasa()
  const pastaB = join(casa, '.claude-b')
  mkdirSync(pastaB)
  gravarConfig(
    config([
      { ...conta('a'), config: '~/.claude-b' },
      { ...conta('b'), config: `${pastaB.replace(/\\/g, '/')}/` },
      { ...conta('padrao'), config: '~/.claude' },
      { ...conta('semconfig'), config: null },
    ]),
  )
  mkdirSync(join(casa, '.claude'), { recursive: true })
  const w = await mountWorker(main)
  await w.request('requisitos.instalar', { id: 'skill' })
  await w.request('requisitos.instalar', { id: 'hooks' })
  await w.request('config.gravar', { valores: { 'conta.a.remover': '1' } })
  assert.match(readFileSync(join(pastaB, 'settings.json'), 'utf8'), /agent-pool/)
  assert.equal(existsSync(join(pastaB, 'skills', 'agent-pool')), true)
  await w.request('config.gravar', { valores: { 'conta.padrao.remover': '1' } })
  assert.match(readFileSync(join(casa, '.claude', 'settings.json'), 'utf8'), /agent-pool/)
  assert.equal(existsSync(join(casa, '.claude', 'skills', 'agent-pool')), true)
  await w.deactivate()
})

test('desinstalar com arquivo de agente ilegível mantém skill, lançador e config; hooks já tirados de outros arquivos não voltam', async () => {
  novaCasa()
  gravarConfig(config([conta('a'), conta('b', 'codex')]))
  const w = await mountWorker(main)
  for (const id of ['lancador', 'skill', 'hooks'] as const) await w.request('requisitos.instalar', { id })
  assert.match(readFileSync(join(casa, '.codex', 'hooks.json'), 'utf8'), /agent-pool/)
  writeFileSync(join(casa, '.claude', 'settings.json'), '{ quebrado')
  await assert.rejects(w.request('desinstalar'), (x: unknown) => (x as { code?: string }).code === 'hooks_falhou')
  const hooksCodex = join(casa, '.codex', 'hooks.json')
  assert.equal(existsSync(hooksCodex) && readFileSync(hooksCodex, 'utf8').includes('agent-pool'), false)
  assert.equal(existsSync(join(raizDados(), 'config.json')), true)
  assert.equal(existsSync(join(casa, '.agents', 'skills', 'agent-pool')), true)
  assert.equal(existsSync(join(casa, '.agents', 'bin', 'agent-pool')), true)
  await w.deactivate()
})

test('config.gravar recusado manda `chave: codigo` para o painel traduzir', async () => {
  novaCasa()
  gravarConfig(config())
  const w = await mountWorker(main)
  await assert.rejects(
    w.request('config.gravar', { valores: { 'fila.vagas': '0' } }),
    (x: unknown) => (x as { message?: string }).message === 'fila.vagas: valor_invalido',
  )
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
  await assert.rejects(
    w.request('hooks.reinstalar', { agente: 'claude' }),
    (x: unknown) => (x as { code?: string }).code === 'hooks_falhou',
  )
  assert.equal(readFileSync(join(casa, '.claude', 'settings.json'), 'utf8'), '{ nao e json')
  await w.deactivate()
})

test('mudança no estado em disco dispara um único estado.mudou por rajada', async () => {
  novaCasa()
  const w = await mountWorker(main)
  await ativado(w)
  await new Promise(r => setTimeout(r, 500))
  const antes = w.posts.length
  mkdirSync(join(raizDados(), 'state', 'fila', 'x', '1'), { recursive: true })
  writeFileSync(join(raizDados(), 'state', 'fila', 'x', '1', 'pid'), '1')
  writeFileSync(join(raizDados(), 'state', 'fila', 'x', '1', 'inicio'), '1')
  await ate(() => w.posts.length > antes)
  await new Promise(r => setTimeout(r, 600))
  assert.equal(w.posts.length, antes + 1)
  await w.deactivate()
})

test('requisitos.ler com forcar relê na hora; sem forcar usa o guardado; lançador com ~, desatualizado quando aponta para outra pasta', async () => {
  novaCasa()
  const w = await mountWorker(main)
  const lancador = (r: { itens: { id: string; ok: boolean; detalhe: unknown }[] }) => r.itens.find(i => i.id === 'lancador')!
  const nome = process.platform === 'win32' ? 'agent-pool.cmd' : 'agent-pool'
  assert.deepEqual(lancador(await w.request('requisitos.ler')).detalhe, { codigo: 'nao_instalado' }) // a ativação não instala
  const primeiro = lancador(await w.request('requisitos.instalar', { id: 'lancador' }))
  assert.equal(primeiro.ok, true)
  assert.deepEqual(primeiro.detalhe, { codigo: 'instalado', valor: join('~', '.agents', 'bin', nome) })
  writeFileSync(join(casa, '.agents', 'bin', 'agent-pool'), '#!/bin/sh\nexec node "/versao/antiga/main.ts" "$@"\n')
  assert.equal(lancador(await w.request('requisitos.ler')).ok, true) // guardado por 60 s
  assert.equal(lancador(await w.request('requisitos.ler', {})).ok, true)
  assert.deepEqual(lancador(await w.request('requisitos.ler', { forcar: true })).detalhe, { codigo: 'desatualizado' })
  rmSync(join(casa, '.agents', 'bin', nome))
  assert.deepEqual(lancador(await w.request('requisitos.ler', { forcar: true })).detalhe, { codigo: 'nao_instalado' })
  await w.deactivate()
})

// --- requisitos (lógica pura) ---
const depsOk = {
  orca: async (args: string[]) =>
    args[0] === '--version' ? '1.4.248' : JSON.stringify({ result: { skills: [{ name: 'orchestration' }] } }),
  skill: () => ({ estado: 'ok' as const }),
  lancador: () => 'ok' as const,
  hooks: () => [{ agente: 'claude', estado: 'instalado' as const }],
  instalar: async () => {},
}

test('requisitos: tudo certo, versão antiga, hook ausente e lançador desatualizado travam com os arquivos do clique', async () => {
  assert.equal((await criarRequisitos(depsOk).ler()).ok, true)
  assert.equal(versaoAtende('1.4.247'), false)
  assert.equal(versaoAtende('1.4.248'), true)
  assert.equal(versaoAtende('v1.5.0'), true)
  assert.equal(versaoAtende('sem versão'), null)
  const velha = await criarRequisitos({ ...depsOk, orca: async a => (a[0] === '--version' ? '1.4.100' : depsOk.orca(a)) }).ler()
  assert.equal(velha.itens[0].ok, false)
  const arquivos = (id: string) => [`~/${id}`]
  const ausente = await criarRequisitos({ ...depsOk, arquivos, hooks: () => [{ agente: 'claude', estado: 'ausente' as const }] }).ler()
  const hooks = ausente.itens.find(i => i.id === 'hooks')!
  assert.deepEqual([hooks.ok, hooks.instalar, hooks.arquivos], [false, true, ['~/hooks']])
  const velho = await criarRequisitos({ ...depsOk, arquivos, lancador: () => 'desatualizado' as const }).ler()
  const l = velho.itens.find(i => i.id === 'lancador')!
  assert.deepEqual([l.ok, l.detalhe, l.arquivos], [false, { codigo: 'desatualizado' }, ['~/lancador']])
  assert.equal(velho.itens.find(i => i.id === 'skill')?.arquivos, undefined) // só quem tem o que instalar lista arquivos
  const semSkill = await criarRequisitos({ ...depsOk, skill: () => ({ estado: 'editada' as const }) }).ler()
  assert.equal(semSkill.ok, true) // skill editada é respeitada
})

test('requisitos: leitura em voo durante a instalação ou a invalidação não guarda o estado velho', async () => {
  let hooks: 'instalado' | 'ausente' = 'instalado'
  let liberar: () => void = () => {}
  let prender = false
  let coletas = 0
  const r = criarRequisitos({
    ...depsOk,
    hooks: () => {
      coletas++
      return [{ agente: 'claude', estado: hooks }]
    },
    instalar: async () => {
      hooks = 'instalado'
    },
    orca: async a => {
      if (a[0] === '--version' && prender) {
        prender = false
        await new Promise<void>(ok => {
          liberar = ok
        })
      }
      return depsOk.orca(a)
    },
  })
  const hooksOk = async () => (await r.ler()).itens.find(i => i.id === 'hooks')?.ok

  // invalidar com coleta em voo (hooks.remover): o "hooks ok" lido antes da remoção não fica guardado.
  prender = true
  const velha = r.ler()
  hooks = 'ausente'
  r.invalidar()
  liberar()
  await velha
  assert.equal(await hooksOk(), false)

  // instalar com leitura presa no meio da instalação: a resposta vem de uma coleta nova, não da leitura em voo.
  hooks = 'ausente'
  r.invalidar()
  prender = true
  const meio = r.ler()
  const antes = coletas
  const instalando = r.instalar('hooks')
  assert.equal((await instalando).itens.find(i => i.id === 'hooks')?.ok, true)
  assert.equal(coletas, antes + 1)
  liberar()
  await meio
  assert.equal(await hooksOk(), true)
})

test('requisitos: reler coleta de novo mesmo com uma coleta em voo', async () => {
  let liberar: () => void = () => {}
  let primeira = true
  let coletas = 0
  const r = criarRequisitos({
    ...depsOk,
    lancador: () => {
      coletas++
      return 'ok' as const
    },
    orca: async a => {
      if (a[0] === '--version' && primeira) {
        primeira = false
        await new Promise<void>(ok => {
          liberar = ok
        })
      }
      return depsOk.orca(a)
    },
  })
  const emVoo = r.ler()
  const forcada = r.reler()
  liberar()
  await emVoo
  await forcada
  assert.equal(coletas, 2)
})

test('requisitos: instalar relê o estado e guarda por 60 s', async () => {
  let t = 0
  let lancador = false
  let chamadas = 0
  const r = criarRequisitos({
    ...depsOk,
    lancador: () => {
      chamadas++
      return lancador ? 'ok' : 'ausente'
    },
    instalar: async () => {
      lancador = true
    },
    agora: () => t,
  })
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
      avancar: async ms => {
        mock.timers.tick(ms)
        for (let i = 0; i < 5; i++) await Promise.resolve()
      },
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
        return coletas === 1 ? new Promise<void>(r => (termina = r)) : Promise.resolve()
      },
      avisar: () => {},
      erro: () => {},
      renovaMs: 1_000_000,
      gracaMs: 3_000,
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

test('requisitos e instalar olham só as contas ativas; ativar a conta volta a pedir o que falta do agente dela', async () => {
  novaCasa()
  gravarConfig(config([conta('a'), { ...conta('b', 'codex'), ativo: false, origem: 'orca' }]))
  const w = await mountWorker(main)
  const item = async (id: string) => (await w.request('requisitos.ler', { forcar: true })).itens.find(i => i.id === id)!
  assert.deepEqual((await item('hooks')).arquivos, [join('~', '.claude', 'settings.json')])
  assert.equal(
    (await item('skill')).arquivos?.some(f => f.includes('.codex')),
    false,
  )

  for (const id of ['lancador', 'skill', 'hooks'] as const) await w.request('requisitos.instalar', { id })
  assert.equal(existsSync(join(casa, '.codex', 'hooks.json')), false)
  assert.equal(existsSync(join(casa, '.codex', 'skills', 'agent-pool')), false)
  assert.equal((await item('hooks')).ok, true)

  await w.request('config.gravar', { valores: { 'conta.b.ativo': 'sim' } })
  const hooks = await item('hooks')
  assert.equal(hooks.ok, false)
  assert.deepEqual(hooks.arquivos, [join('~', '.codex', 'hooks.json')])
  assert.equal((await item('skill')).ok, false)
  await w.deactivate()
})

test('trocar a pasta da conta tira hook e link da pasta antiga', async () => {
  novaCasa()
  const antiga = join(casa, '.claude-work')
  mkdirSync(antiga, { recursive: true })
  mkdirSync(join(casa, '.claude-job'), { recursive: true })
  const original = `${JSON.stringify({ model: 'x' }, null, 2)}\n`
  writeFileSync(join(antiga, 'settings.json'), original)
  gravarConfig(config([{ ...conta('w'), config: '~/.claude-work' }]))
  const w = await mountWorker(main)
  await w.request('requisitos.instalar', { id: 'skill' })
  await w.request('requisitos.instalar', { id: 'hooks' })
  assert.match(readFileSync(join(antiga, 'settings.json'), 'utf8'), /agent-pool/)

  await w.request('config.gravar', { valores: { 'conta.w.config': '~/.claude-job' } })
  assert.equal(readFileSync(join(antiga, 'settings.json'), 'utf8'), original)
  assert.equal(existsSync(join(antiga, 'skills', 'agent-pool')), false)
  await w.deactivate()
})

test('desinstalar tira o nosso link mesmo quando a pasta skills da conta é link para outro lugar', async () => {
  novaCasa()
  const compartilhada = join(casa, 'compartilhada')
  mkdirSync(compartilhada, { recursive: true })
  mkdirSync(join(casa, '.claude-c'), { recursive: true })
  symlinkSync(compartilhada, join(casa, '.claude-c', 'skills'), 'junction')
  gravarConfig(config([{ ...conta('c'), config: '~/.claude-c' }]))
  const w = await mountWorker(main)
  await w.request('requisitos.instalar', { id: 'skill' })
  assert.equal(existsSync(join(compartilhada, 'agent-pool')), true)

  await w.request('desinstalar')
  assert.throws(() => lstatSync(join(compartilhada, 'agent-pool')), /ENOENT/) // existsSync seguiria o link pendurado
  await w.deactivate()
})

test('hook do Codex da 1.0.10 (timeout 10) é desatualizado; Instalar troca o grupo e o config.toml fica intocado', async () => {
  novaCasa()
  gravarConfig(config([conta('b', 'codex')]))
  const lancador = join(casa, '.agents', 'bin', process.platform === 'win32' ? 'agent-pool.cmd' : 'agent-pool')
  const grupo = (timeout: number) => ({
    hooks: [{ type: 'command', command: `${process.platform === 'win32' ? '& ' : ''}"${lancador}" hook codex`, timeout }],
  })
  mkdirSync(join(casa, '.codex'), { recursive: true })
  const arquivo = join(casa, '.codex', 'hooks.json')
  writeFileSync(arquivo, JSON.stringify({ hooks: { PreToolUse: [grupo(10)] } }))
  const toml = '[hooks.state."agent-pool"]\ntrusted_hash = "sha256:antigo"\n'
  writeFileSync(join(casa, '.codex', 'config.toml'), toml)
  const w = await mountWorker(main)

  assert.equal((await w.request('hooks.estado'))[1].estado, 'desatualizado')
  const antes = (await w.request('requisitos.ler', { forcar: true })).itens.find(i => i.id === 'hooks')!
  assert.equal(antes.ok, false)
  assert.deepEqual(antes.arquivos, [join('~', '.codex', 'hooks.json')])

  await w.request('requisitos.instalar', { id: 'hooks' })
  assert.equal((await w.request('hooks.estado'))[1].estado, 'instalado')
  assert.deepEqual(JSON.parse(readFileSync(arquivo, 'utf8')).hooks.PreToolUse, [grupo(15)])
  assert.equal(readFileSync(join(casa, '.codex', 'config.toml'), 'utf8'), toml)
  await w.deactivate()
})
