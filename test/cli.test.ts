import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { executar } from '../src/cli/executar.ts'
import { aplicar, carregar, gravar } from '../src/core/config.ts'
import { paths } from '../src/core/paths.ts'
import type { OrcaCli } from '../src/core/tipos.ts'
import { cfg, conta } from './helpers/pool.ts'
import { envCasa, guardarCasaReal } from './helpers/casa.ts'

guardarCasaReal()

const raizes: string[] = []
const novoHome = () => {
  const h = mkdtempSync(join(tmpdir(), 'cli-'))
  raizes.push(h)
  return h
}
after(() => raizes.forEach((h) => rmSync(h, { recursive: true, force: true })))

// Orca falso: memória farta e nenhum worker listado.
const orcaFalso: OrcaCli = {
  async run(args) {
    if (args[0] === 'diagnostics') return { code: 0, stdout: JSON.stringify({ ok: true, result: { host: { availableMemory: 16 * 1073741824 } } }), stderr: '' }
    if (args[1] === 'worker-list') return { code: 0, stdout: JSON.stringify({ ok: true, result: { workers: [] } }), stderr: '' }
    return { code: 1, stdout: '', stderr: 'fora' }
  }
}

// Uso do Claude: 10% na janela curta, 20% na semanal.
const RESET = '2023-11-20T00:00:00Z'
const fetchFalso = (async () =>
  new Response(JSON.stringify({ five_hour: { utilization: 10 }, seven_day: { utilization: 20, resets_at: RESET } }), { status: 200 })) as typeof fetch

async function rodar(home: string, args: string[], extra: { stdin?: string; cwd?: string; orca?: OrcaCli; env?: NodeJS.ProcessEnv } = {}) {
  const out: string[] = []
  const err: string[] = []
  const code = await executar(args, {
    home, env: envCasa(home, { ...process.env, LANG: 'pt_BR', LC_ALL: '', ...extra.env }), orca: extra.orca ?? orcaFalso, fetch: fetchFalso, cwd: extra.cwd ?? home, agora: () => 1_700_000_000_000,
    stdin: async () => extra.stdin ?? '', out: (s) => out.push(s), err: (s) => err.push(s)
  })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

const comConfig = (contas = [conta('a', { vagas: 1 }), conta('b', { vagas: 1 })]) => {
  const home = novoHome()
  gravar(cfg(contas), paths(home))
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(join(home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok-falso', expiresAt: 4e12 } }))
  return home
}

for (const [env, ingles] of [
  [{ LANG: '', LC_ALL: '' }, true],
  [{ LANG: 'en_US', LC_ALL: '' }, true],
  [{ LANG: 'pt_BR.UTF-8', LC_ALL: '' }, false],
  [{ LANG: 'en_US', LC_ALL: 'pt_PT' }, false],
  [{ LANG: 'pt_BR', LC_ALL: 'en_US' }, true]
] as const) {
  it(`idioma CLI ${JSON.stringify(env)}`, async () => {
    const home = comConfig()
    assert.match((await rodar(home, ['--help'], { env })).err, ingles ? /usage:.*command/ : /uso:.*comando/)
    assert.match((await rodar(home, ['status'], { env })).out, ingles ? /queue database: 0 running/ : /fila banco: 0 rodando/)
    assert.match((await rodar(home, ['measure', 'a'], { env })).out, ingles ? /weekly/ : /semanal/)
    assert.match((await rodar(home, ['measure', 'ausente'], { env })).err, ingles ? /unknown account/ : /conta desconhecida/)
    assert.match((await rodar(home, ['writer', '--reserve', 'x'], { env })).out, ingles ? /reserve res-x/ : /reserva res-x/)
    assert.match((await rodar(home, ['config', 'set', 'fila.vagas=0'], { env })).err, ingles ? /invalid value/ : /valor inválido/)
    assert.match((await rodar(home, ['doctor'], { env })).out, ingles ? /missing launcher/ : /falta lançador/)
    assert.match((await rodar(home, ['second', '--family', 'claude'], { env })).err, ingles ? /no eligible second opinion/ : /sem segunda opinião apta/)
    assert.match((await rodar(home, ['slot', 'swap', 'ausente', 'destino'], { env })).err, ingles ? /reservation ausente does not exist/ : /reserva ausente não existe/)
    assert.match((await rodar(home, ['writer', '--reserve', 'a b'], { env })).err, ingles ? /invalid name/ : /nome inválido/)
    assert.match((await rodar(home, ['hook', 'claude'], { env, stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } }) })).err, ingles ? /Run the test part through the queue/ : /Execute o trecho de teste pela fila/)
    for (const args of [['status'], ['measure'], ['doctor'], ['slot', 'free'], ['config', 'get']]) {
      assert.equal((await rodar(home, args, { env })).out.split('\n').length, 1, args.join(' '))
    }
    const englishJson = await rodar(home, ['status', '--json'], { env: { LANG: 'en', LC_ALL: '' } })
    const portugueseJson = await rodar(home, ['status', '--json'], { env: { LANG: 'pt', LC_ALL: '' } })
    assert.equal(englishJson.out, portugueseJson.out)
  })
}

describe('uso', () => {
  it('sem comando ou comando desconhecido sai 2', async () => {
    assert.equal((await rodar(novoHome(), [])).code, 2)
    assert.equal((await rodar(novoHome(), ['voar'])).code, 2)
  })
  it('config de versão futura: erro claro, código 2 e o arquivo intacto', async () => {
    const home = novoHome()
    const p = paths(home)
    mkdirSync(p.raiz, { recursive: true })
    writeFileSync(p.config, '{"versao":2}')
    const r = await rodar(home, ['status'])
    assert.equal(r.code, 2)
    assert.match(r.err, /versao/)
  })
})

describe('status', () => {
  it('uma linha legível e --json', async () => {
    const home = comConfig()
    const r = await rodar(home, ['status'])
    assert.equal(r.code, 0)
    assert.equal(r.out.split('\n').length, 1)
    assert.match(r.out, /fila banco: 0 rodando.*pool ritmo: a 0\/1 em uso, b 0\/1 em uso/)
    assert.match((await rodar(home, ['status'], { env: { LANG: 'en', LC_ALL: '' } })).out, /queue database: 0 running.*a 0\/1 in use/)
    const j = JSON.parse((await rodar(home, ['status', '--json'])).out)
    assert.equal(j.fila.modo, 'banco')
    assert.deepEqual(j.pool.contas.map((c: { conta: string }) => c.conta), ['a', 'b'])
  })
  it('conta com pasta própria ausente aparece como não configurada, em texto e --json', async () => {
    const home = comConfig([conta('team', { config: '~/.claude-team', vagas: 1 })])
    assert.match((await rodar(home, ['status'])).out, /team \(não configurada nesta máquina\)/)
    const j = JSON.parse((await rodar(home, ['status', '--json'])).out)
    assert.deepEqual([j.pool.contas[0].medida.estado, j.pool.contas[0].medida.erro], ['nao_configurada', `pasta_ausente:${join(home, '.claude-team')}`])
    assert.match((await rodar(home, ['measure'])).out, /team: não configurada nesta máquina: pasta .*\.claude-team não existe/)
  })
  it('--json mostra a medida do limite seguido (agy sem modelo segue Gemini Models, não o geral do Argon)', async () => {
    const home = comConfig([conta('agy', { agente: 'antigravity', vagas: 1 })])
    const buckets = [
      { group: 'Gemini Models', usedPercent: 0, windowMinutes: 300 },
      { group: 'Gemini Models', usedPercent: 0, windowMinutes: 10080 },
      { group: 'Gemini 4 Argon', usedPercent: 70, windowMinutes: 10080 }
    ]
    const limites = { antigravity: { provider: 'antigravity', status: 'ok', session: { usedPercent: 0 }, weekly: { usedPercent: 70 }, buckets } }
    const orca: OrcaCli = {
      async run(args) {
        if (args[0] === 'account') return { code: 0, stdout: JSON.stringify({ ok: true, result: { rateLimits: limites } }), stderr: '' }
        return orcaFalso.run(args)
      }
    }
    const j = JSON.parse((await rodar(home, ['status', '--json'], { orca })).out)
    assert.equal(j.pool.contas[0].medida.longa, 0)
  })
  it('sem config usa o padrão', async () => {
    assert.match((await rodar(novoHome(), ['status'])).out, /nenhuma conta/)
  })
})

describe('config', () => {
  it('CLI espera a trava e relê a configuração sem perder a alteração concorrente', async () => {
    const home = comConfig()
    const p = paths(home)
    const trava = `${p.config}.lock`
    const pronto = join(home, 'pronto')
    mkdirSync(trava)
    writeFileSync(join(trava, 'info.json'), JSON.stringify({ pid: process.pid }))
    const filho = spawn(process.execPath, ['--experimental-strip-types', join(import.meta.dirname, 'cli-config-filho.ts'), home, pronto], { stdio: 'ignore', env: envCasa(home) })
    const terminou = new Promise((resolve) => filho.on('close', resolve))
    try {
      const prazo = Date.now() + 10_000
      while (!existsSync(pronto) && Date.now() < prazo) await new Promise((r) => setTimeout(r, 20))
      assert.ok(existsSync(pronto), 'filho iniciou o CLI')
      await new Promise((r) => setTimeout(r, 150))
      assert.equal(carregar(p).fila.vagas, 2, 'CLI aguarda a trava do outro escritor')
      gravar(aplicar(carregar(p), { 'pool.teto': '9' }), p)
    } finally { rmSync(trava, { recursive: true, force: true }) }
    assert.equal(await terminou, 0)
    assert.equal(carregar(p).pool.teto, 9)
    assert.equal(carregar(p).fila.vagas, 7)
  })
  it('set grava e get lê; valor inválido sai 2 sem gravar', async () => {
    const home = comConfig()
    assert.equal((await rodar(home, ['config', 'set', 'fila.vagas=3', 'pool.teto=4'])).code, 0)
    assert.equal((await rodar(home, ['config', 'get', 'fila.vagas'])).out, '3')
    assert.equal(JSON.parse((await rodar(home, ['config', 'get'])).out).pool.teto, 4)
    assert.equal((await rodar(home, ['config', 'set', 'fila.vagas=0'])).code, 2)
    assert.equal((await rodar(home, ['config', 'get', 'fila.vagas'])).out, '3')
    assert.equal((await rodar(home, ['config', 'set', 'semigual'])).code, 2)
    assert.equal((await rodar(home, ['config', 'get', 'nada.aqui'])).code, 2)
  })
})

describe('writer e slot', () => {
  it('tradução da escolha preserva o nome da conta', async () => {
    const r = await rodar(comConfig([conta('ritmo')]), ['writer'], { env: { LANG: 'en', LC_ALL: '' } })
    assert.equal(r.code, 0)
    assert.match(r.out, /^ritmo \(pace .*% free/)
  })
  it('em inglês a escolha não vaza português e conta ilimitada aparece como N/∞', async () => {
    const home = comConfig([conta('ritmo', { vagas: 0, peso: 3 }), conta('sem', { agente: 'codex', vagas: 1 })])
    const en = { LANG: 'en', LC_ALL: '' }
    const r = await rodar(home, ['writer', '--reserve', 'u1'], { env: en })
    assert.doesNotMatch(r.out, /ritmo \d|livre|zera|peso|sem medidor/)
    assert.match(r.out, /weight 3/)
    assert.match((await rodar(home, ['status'], { env: en })).out, /ritmo 1\/∞ in use/)
    assert.match((await rodar(home, ['slot', 'free'], { env: en })).out, /ritmo 1\/∞ in use/)
  })
  it('test com a fila ocupada avisa no idioma do ambiente', async () => {
    const home = comConfig()
    const p = paths(home)
    gravar(aplicar(carregar(p), { 'fila.modo': 'global', 'fila.vagas': '1' }), p)
    const dir = join(p.fila, 'global', '1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'info.json'), JSON.stringify({ pid: process.pid, inicio: 1, fila: 'global' }))
    const c = carregar(p)
    c.fila.esperaMaxS = 1
    gravar(c, p)
    const en = await rodar(home, ['test', '--', process.execPath, '-e', '0'], { env: { LANG: 'en', LC_ALL: '' } })
    assert.equal(en.code, 75)
    assert.match(en.err, /Waiting for queue global/)
    assert.match(en.err, /QUEUE BUSY — global — run again/)
    assert.doesNotMatch(en.err, /Aguardando|OCUPADA/)
    assert.match((await rodar(home, ['test', '--', process.execPath, '-e', '0'])).err, /FILA OCUPADA — global — rode de novo/)
  })
  it('trava da máquina presa por pid vivo sai 75 no idioma do ambiente', async () => {
    const home = comConfig()
    const dir = join(paths(home).vagas, '.maquina')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'info.json'), JSON.stringify({ pid: process.pid, inicio: 1 }))
    const r = await rodar(home, ['slot', 'release', 'x'], { env: { LANG: 'en', LC_ALL: '' } })
    assert.equal(r.code, 75)
    assert.match(r.err, /machine reservation in progress/)
    assert.doesNotMatch(r.err, /reserva da máquina/)
  })
  it('reserva até acabar as vagas e sai 75', async () => {
    const home = comConfig()
    const r1 = await rodar(home, ['writer', '--reserve', 't1'])
    assert.equal(r1.code, 0)
    assert.match(r1.out, /^a .*reserva res-t1$/)
    assert.match((await rodar(home, ['writer', '--reserve', 't2'])).out, /^b /)
    const r3 = await rodar(home, ['writer', '--reserve', 't3'])
    assert.equal(r3.code, 75)
    assert.match(r3.err, /sem vaga/)
  })
  it('--json traz conta e dono; tag inválida sai 2', async () => {
    const home = comConfig()
    const j = JSON.parse((await rodar(home, ['writer', '--reserve', 'x', '--json'])).out)
    assert.equal(j.conta, 'a')
    assert.equal(j.dono, 'res-x')
    assert.equal((await rodar(home, ['writer', '--reserve', 'a b'])).code, 2)
    assert.equal((await rodar(home, ['writer', '--reserve'])).code, 2)
  })
  it('sem --reserve só escolhe, sem ocupar vaga', async () => {
    const home = comConfig()
    assert.match((await rodar(home, ['writer'])).out, /^a /)
    assert.match((await rodar(home, ['slot', 'free'])).out, /a 1\/1 livres · b 1\/1 livres/)
    assert.match((await rodar(home, ['slot', 'free'], { env: { LANG: 'en', LC_ALL: '' } })).out, /a 1\/1 free/)
  })
  it('take, swap, release e free', async () => {
    const home = comConfig()
    assert.equal((await rodar(home, ['slot', 'take', 'nada', 'd1'])).code, 2)
    assert.equal((await rodar(home, ['slot', 'take', 'a', 'res-t'])).code, 0)
    assert.equal((await rodar(home, ['slot', 'take', 'a', 'outro'])).code, 75)
    assert.equal((await rodar(home, ['slot', 'swap', 'res-t', 'disp-1'])).code, 0)
    assert.equal((await rodar(home, ['slot', 'swap', 'res-x', 'disp-2'])).code, 75)
    assert.match((await rodar(home, ['slot', 'free'])).out, /a 0\/1 livres/)
    assert.equal((await rodar(home, ['slot', 'release', 'disp-1'])).code, 0)
    assert.match((await rodar(home, ['slot', 'free'])).out, /a 1\/1 livres/)
    assert.equal((await rodar(home, ['slot', 'quebrado'])).code, 2)
  })
  it('free recupera a vaga de dispatch que o Orca diz encerrado', async () => {
    const home = comConfig()
    await rodar(home, ['slot', 'take', 'a', 'disp-9'])
    const orca: OrcaCli = {
      async run(args) {
        const w = [{ dispatchId: 'disp-9', dispatchStatus: 'completed' }]
        return args[1] === 'worker-list' ? { code: 0, stdout: JSON.stringify({ ok: true, result: { workers: w } }), stderr: '' } : orcaFalso.run(args)
      }
    }
    assert.match((await rodar(home, ['slot', 'free'], { orca })).out, /a 1\/1 livres/)
  })
})

describe('second, measure e doctor', () => {
  it('second sem medida sai 75; sem --family sai 2', async () => {
    const home = comConfig()
    assert.equal((await rodar(home, ['second', '--family', 'claude'])).code, 75)
    assert.equal((await rodar(home, ['second'])).code, 2)
  })
  it('second valida a família: id de agente vale, texto fora do catálogo sai 2', async () => {
    const home = comConfig([conta('a', { vagas: 1 })])
    assert.equal((await rodar(home, ['second', '--family', 'banana'])).code, 2)
    assert.equal((await rodar(home, ['second', '--family', 'outro'])).code, 2)
    assert.match((await rodar(home, ['second', '--family', 'codex'])).out, /^a /) // codex → família gpt: a conta claude serve
    assert.match((await rodar(home, ['second', '--family', 'GPT'])).out, /^a /)
    assert.equal((await rodar(home, ['second', '--family', 'Claude'])).code, 75) // claude → minúsculas; só há conta claude
  })
  it('measure lista as contas; conta desconhecida sai 2', async () => {
    const home = comConfig()
    assert.match((await rodar(home, ['measure'])).out, /^a: 5h 10% · semanal 20% · b: 5h 10% · semanal 20%$/)
    const [m] = JSON.parse((await rodar(home, ['measure', 'a', '--json'])).out)
    assert.equal(m.resetLongaTs, Date.parse(RESET)) // ms, como o pool espera
    assert.equal(m.medidaTs, 1_700_000_000_000)
    assert.match((await rodar(home, ['measure', 'b'])).out, /^b: /)
    assert.equal((await rodar(home, ['measure', 'zz'])).code, 2)
  })
  it('doctor só exige o hook dos agentes da config', async () => {
    const home = comConfig([conta('a', { vagas: 1 })])
    const lancador = join(home, '.agents', 'bin')
    mkdirSync(lancador, { recursive: true })
    writeFileSync(join(lancador, 'agent-pool'), '#!/bin/sh\n')
    mkdirSync(join(home, '.agents', 'skills', 'agent-pool'), { recursive: true })
    writeFileSync(join(home, '.agents', 'skills', 'agent-pool', 'SKILL.md'), 'x')
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: `"${join(lancador, 'agent-pool')}" hook claude` }] }] } }))
    const r = await rodar(home, ['doctor'])
    assert.doesNotMatch(r.out, /hook codex/)
    assert.equal(r.code, 0, r.out)
  })
  it('doctor mostra uma linha de hook por pasta de conta e acusa a que falta', async () => {
    const home = comConfig([conta('a', { vagas: 1 }), conta('b', { vagas: 1, config: join(tmpdir(), 'conta-inexistente-b') })])
    const r = await rodar(home, ['doctor', '--json'])
    const hooks = JSON.parse(r.out).filter((i: { item: string }) => i.item === 'hook claude')
    assert.equal(hooks.length, 2)
    assert.ok(hooks.some((h: { detalhe: string }) => h.detalhe.includes('conta-inexistente-b')))
  })
  it('doctor aponta o que falta', async () => {
    const r = await rodar(comConfig(), ['doctor'])
    assert.equal(r.code, 1)
    assert.match(r.out, /ok    config \(2 conta\(s\)\) · ok    orca · falta lançador/)
    assert.equal(JSON.parse((await rodar(comConfig(), ['doctor', '--json'])).out).length, 5)
  })
})

describe('test', () => {
  it('devolve o código do comando pela fila e libera tudo', async () => {
    const home = comConfig()
    const cwd = novoHome()
    assert.equal((await rodar(home, ['test', '--', process.execPath, '-e', 'process.exit(0)'], { cwd })).code, 0)
    assert.equal((await rodar(home, ['test', '--', process.execPath, '-e', 'process.exit(3)'], { cwd })).code, 3)
    assert.match((await rodar(home, ['status'])).out, /0 rodando, 0 aguardando, 0 parados/)
  })
  it('argumento solto ou -- vazio sai 2; sem stack e sem comando sai 2', async () => {
    const home = comConfig()
    assert.equal((await rodar(home, ['test', 'tests/Foo.php'])).code, 2)
    assert.equal((await rodar(home, ['test', '--'])).code, 2)
    assert.equal((await rodar(home, ['test'], { cwd: novoHome() })).code, 2)
  })
})

describe('hook', () => {
  it('Codex permite edição que cita testes e bloqueia apenas ferramentas shell', async () => {
    for (const tool_name of ['apply_patch', 'functions.apply_patch', 'write_file']) {
      const r = await rodar(novoHome(), ['hook', 'codex'], { stdin: JSON.stringify({ tool_name, tool_input: { cmd: 'npm test' } }) })
      assert.equal(r.out, '')
    }
    for (const tool_name of ['exec_command', 'functions.exec_command', 'shell']) {
      const r = await rodar(novoHome(), ['hook', 'codex'], { stdin: JSON.stringify({ tool_name, tool_input: { cmd: 'npm test' } }) })
      assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, 'deny')
    }
  })
  const entrada = (command: unknown) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } })
  it('claude: nega com exit 2 e a sugestão no stderr', async () => {
    const r = await rodar(novoHome(), ['hook', 'claude'], { stdin: entrada('npm test') })
    assert.equal(r.code, 2)
    assert.match(r.err, /agent-pool(\.cmd)?" test -- npm test/)
  })
  it('sugestão ganha prefixo & só no PowerShell (Claude e Codex)', async () => {
    const pedir = async (agente: string, stdin: unknown) => {
      const r = await rodar(novoHome(), ['hook', agente], { stdin: JSON.stringify(stdin) })
      return r.err + r.out
    }
    assert.match(await pedir('claude', { tool_name: 'PowerShell', tool_input: { command: 'npm test' } }), /`& "/)
    assert.doesNotMatch(await pedir('claude', { tool_name: 'Bash', tool_input: { command: 'npm test' } }), /`& "/)
    assert.match(await pedir('codex', { tool_name: 'shell', tool_input: { command: ['powershell.exe', '-Command', 'npm test'] } }), /`& \\"/)
  })
  it('claude: sugere o caminho absoluto do lançador da casa e só o trecho de teste', async () => {
    const home = novoHome()
    const r = await rodar(home, ['hook', 'claude'], { stdin: entrada('cd api && pytest -q') })
    const lancador = join(home, '.agents', 'bin', process.platform === 'win32' ? 'agent-pool.cmd' : 'agent-pool').replace(/\\/g, '/')
    assert.ok(r.err.includes(`"${lancador}" test -- pytest -q`), r.err)
    assert.ok(!r.err.includes('-- cd api'), r.err)
  })
  it('codex: nega com JSON de deny, inclusive com o comando em lista', async () => {
    for (const c of ['pytest -q', ['bash', '-lc', 'pytest -q']]) {
      const r = await rodar(novoHome(), ['hook', 'codex'], { stdin: entrada(c) })
      assert.equal(r.code, 0)
      const d = JSON.parse(r.out).hookSpecificOutput
      assert.equal(d.permissionDecision, 'deny')
      assert.match(d.permissionDecisionReason, /agent-pool(\.cmd)?" test -- pytest -q/)
    }
  })
  it('libera o que passa pela fila, texto qualquer e JSON ilegível', async () => {
    for (const stdin of [entrada('agent-pool test -- npm test'), entrada('git commit -m "rode pytest"'), 'isto não é json', '{}']) {
      for (const ag of ['claude', 'codex']) {
        const r = await rodar(novoHome(), ['hook', ag], { stdin })
        assert.deepEqual([r.code, r.out, r.err], [0, '', ''], stdin)
      }
    }
    assert.equal((await rodar(novoHome(), ['hook', 'gemini'])).code, 2)
  })
})

describe('modelo', () => {
  const comModelo = () => comConfig([conta('a', { vagas: 1, modelo: 'claude-fable-5-1' })])
  it('writer e second mostram o modelo (texto pt/en e JSON)', async () => {
    const home = comModelo()
    assert.match((await rodar(home, ['writer'])).out, /· modelo claude-fable-5-1$/)
    assert.match((await rodar(home, ['writer'], { env: { LANG: 'en', LC_ALL: '' } })).out, /· model claude-fable-5-1$/)
    assert.equal(JSON.parse((await rodar(home, ['writer', '--json'])).out).modelo, 'claude-fable-5-1')
    assert.match((await rodar(home, ['second', '--family', 'gpt'])).out, /· modelo claude-fable-5-1$/)
    assert.equal(JSON.parse((await rodar(home, ['second', '--family', 'gpt', '--json'])).out).modelo, 'claude-fable-5-1')
  })
  it('sem modelo a linha não muda', async () => {
    assert.doesNotMatch((await rodar(comConfig([conta('a')]), ['writer'])).out, /modelo/)
  })
  it('config set conta.x.modelo grava, valida e limpa', async () => {
    const home = comConfig([conta('a')])
    assert.equal((await rodar(home, ['config', 'set', 'conta.a.modelo=gemini-3.8-flash-high'])).code, 0)
    assert.equal((await rodar(home, ['config', 'get', 'pool.contas.0.modelo'])).out, 'gemini-3.8-flash-high')
    assert.equal((await rodar(home, ['config', 'set', 'conta.a.modelo=a b'])).code, 2)
    assert.equal((await rodar(home, ['config', 'set', 'conta.a.modelo='])).code, 0)
    assert.equal(JSON.parse((await rodar(home, ['config', 'get', 'pool.contas.0'])).out).modelo, null)
  })
})
