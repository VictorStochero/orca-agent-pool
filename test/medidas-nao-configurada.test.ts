import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { medidasGravadas, medirTodas } from '../src/core/medidas/cache.ts'
import { paths } from '../src/core/paths.ts'
import { cfg, conta } from './helpers/pool.ts'

const naoMedir = (async () => {
  throw new Error('não deveria medir')
}) as typeof fetch
const orcaFora = { run: async () => ({ code: 1, stdout: '', stderr: '' }) }

function casa() {
  const home = mkdtempSync(join(tmpdir(), 'nao-configurada-'))
  return { home, p: paths(home), fim: () => rmSync(home, { recursive: true, force: true }) }
}

function binario(dir: string, nome: string) {
  mkdirSync(dir, { recursive: true })
  const arquivo = join(dir, process.platform === 'win32' ? `${nome}.exe` : nome)
  writeFileSync(arquivo, '')
  chmodSync(arquivo, 0o755)
}

test('conta Claude com pasta própria inexistente: não configurada, sem medir, e volta a ser medida quando a pasta aparece', async () => {
  const { home, p, fim } = casa()
  try {
    const c = cfg([conta('team', { config: '~/.claude-team' })])
    let usage = 0
    const d = {
      home,
      agora: 1_700_000_000_000,
      fetch: naoMedir,
      executarUsage: async () => {
        usage++
        return 'Not logged in'
      },
      executarStatus: async () => '',
    }
    const [m] = await medirTodas(c, p, orcaFora, d)
    assert.equal(m.estado, 'nao_configurada')
    assert.equal(m.erro, `pasta_ausente:${join(home, '.claude-team')}`)
    assert.equal(usage, 0)
    mkdirSync(join(home, '.claude-team'))
    const [depois] = await medirTodas(c, p, orcaFora, { ...d, agora: d.agora + 1000 })
    assert.equal(depois.estado, 'sem_login')
    assert.equal(usage, 1)
  } finally {
    fim()
  }
})

test('conta Claude padrão (sem config) não depende de pasta', async () => {
  const { home, p, fim } = casa()
  try {
    const d = {
      home,
      agora: 1_700_000_000_000,
      fetch: naoMedir,
      executarUsage: async () => 'Not logged in',
      executarStatus: async () => '',
    }
    const [m] = await medirTodas(cfg([conta('padrao')]), p, orcaFora, d)
    assert.equal(m.estado, 'sem_login')
  } finally {
    fim()
  }
})

test('executável fora do PATH: medida que falhou vira não configurada (sem cache); com o executável, volta o sem login', async () => {
  const { home, p, fim } = casa()
  try {
    const bin = join(home, 'bin')
    mkdirSync(bin)
    const c = cfg([conta('codex', { agente: 'codex', origem: 'orca' })])
    const semLogin = { codex: { provider: 'codex', status: 'error', usageMetadata: { failureKind: 'missing-credentials' } } }
    const orca = { run: async () => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result: { rateLimits: semLogin } }) }) }
    const d = { home, agora: 1_700_000_000_000, fetch: naoMedir, path: bin }
    const [m] = await medirTodas(c, p, orca, d)
    assert.equal(m.estado, 'nao_configurada')
    assert.equal(m.erro, 'cli_ausente:codex')
    binario(bin, 'codex')
    const [depois] = await medirTodas(c, p, orca, { ...d, agora: d.agora + 1000 })
    assert.equal(depois.estado, 'sem_login')
  } finally {
    fim()
  }
})

test('executável fora do PATH não rebaixa medida que deu certo (o PATH do processo pode não ter tudo o que o terminal tem)', async () => {
  const { home, p, fim } = casa()
  try {
    const c = cfg([conta('codex', { agente: 'codex', origem: 'orca' })])
    const orca = {
      run: async () => ({
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          result: { rateLimits: { codex: { provider: 'codex', status: 'ok', session: { usedPercent: 30 }, weekly: { usedPercent: 40 } } } },
        }),
      }),
    }
    const [m] = await medirTodas(c, p, orca, { home, agora: 1_700_000_000_000, fetch: naoMedir, path: join(home, 'vazio') })
    assert.equal(m.estado, 'ok')
    assert.equal(m.curta, 30)
  } finally {
    fim()
  }
})

test('comando com CLAUDE_CONFIG_DIR=… claude usa claude como executável', async () => {
  const { home, p, fim } = casa()
  try {
    const bin = join(home, 'bin')
    mkdirSync(bin)
    mkdirSync(join(home, '.claude-x'))
    const c = cfg([conta('x', { config: '~/.claude-x', comando: 'CLAUDE_CONFIG_DIR=~/.claude-x claude' })])
    const d = {
      home,
      agora: 1_700_000_000_000,
      fetch: naoMedir,
      path: bin,
      executarUsage: async () => 'Not logged in',
      executarStatus: async () => '',
    }
    const [m] = await medirTodas(c, p, orcaFora, d)
    assert.equal(m.erro, 'cli_ausente:claude')
    binario(bin, 'claude')
    const [ok] = await medirTodas(c, p, orcaFora, { ...d, agora: d.agora + 1000 })
    assert.equal(ok.estado, 'sem_login')
  } finally {
    fim()
  }
})

test('sem_login no cache e CLI removido depois: não configurada, e o cache não guarda esse estado', async () => {
  const { home, p, fim } = casa()
  try {
    const bin = join(home, 'bin')
    binario(bin, 'codex')
    const c = cfg([conta('codex', { agente: 'codex', origem: 'orca' })])
    let chamadas = 0
    const semLogin = { codex: { provider: 'codex', status: 'error', usageMetadata: { failureKind: 'missing-credentials' } } }
    const orca = {
      run: async () => {
        chamadas++
        return { code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result: { rateLimits: semLogin } }) }
      },
    }
    const d = { home, agora: 1_700_000_000_000, fetch: naoMedir, path: bin }
    assert.equal((await medirTodas(c, p, orca, d))[0].estado, 'sem_login')
    rmSync(bin, { recursive: true, force: true })
    const [m] = await medirTodas(c, p, orca, { ...d, agora: d.agora + 1000 })
    assert.deepEqual([m.estado, m.erro, chamadas], ['nao_configurada', 'cli_ausente:codex', 1])
    const gravadas = medidasGravadas(p)
    assert.ok(gravadas.every(g => g.estado !== 'nao_configurada'))
  } finally {
    fim()
  }
})

for (const aspas of [false, true]) {
  test(`comando com caminho${aspas ? ' entre aspas e com espaço' : ''}: confere o próprio arquivo, não o PATH`, async () => {
    const { home, p, fim } = casa()
    try {
      const dir = join(home, aspas ? 'Program Files' : 'ferramentas')
      const exe = join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex')
      const comando = aspas ? `"${exe}" --flag` : `${exe} --flag`
      const c = cfg([conta('codex', { agente: 'codex', origem: 'orca', comando })])
      const semLogin = { codex: { provider: 'codex', status: 'error', usageMetadata: { failureKind: 'missing-credentials' } } }
      const orca = { run: async () => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result: { rateLimits: semLogin } }) }) }
      const d = { home, agora: 1_700_000_000_000, fetch: naoMedir, path: join(home, 'vazio') }
      const [m] = await medirTodas(c, p, orca, d)
      assert.deepEqual([m.estado, m.erro], ['nao_configurada', `cli_ausente:${exe}`])
      binario(dir, 'codex')
      assert.equal((await medirTodas(c, p, orca, { ...d, agora: d.agora + 1000 }))[0].estado, 'sem_login')
    } finally {
      fim()
    }
  })
}

test('comando com ~/ confere o arquivo na casa; com $VAR ou %VAR% não confere (só o shell expande)', async () => {
  const { home, p, fim } = casa()
  try {
    const semLogin = { codex: { provider: 'codex', status: 'error', usageMetadata: { failureKind: 'missing-credentials' } } }
    const orca = { run: async () => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result: { rateLimits: semLogin } }) }) }
    const d = { home, agora: 1_700_000_000_000, fetch: naoMedir, path: join(home, 'vazio') }
    const medir = async (comando: string, agora: number) =>
      (await medirTodas(cfg([conta('codex', { agente: 'codex', origem: 'orca', comando })]), p, orca, { ...d, agora }))[0]
    binario(join(home, 'bin'), 'codex')
    assert.equal((await medir('~/bin/codex --flag', d.agora)).estado, 'sem_login')
    assert.equal((await medir('$HOME/nao-existe/codex', d.agora + 1000)).estado, 'sem_login')
    assert.equal((await medir('%LOCALAPPDATA%\\nao-existe\\codex.exe', d.agora + 2000)).estado, 'sem_login')
  } finally {
    fim()
  }
})
