import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Conta } from '../src/core/tipos.ts'
import { claude, medirClaude } from '../src/core/medidas/claude.ts'

const conta: Conta = { nome: 'main', agente: 'claude', config: '~/.claude-work', comando: null, vagas: 1, peso: 1, papeis: ['escritor'], ativo: true, origem: 'manual' }
const token = 'TOKEN_FALSO_NUNCA_EXIBIR'

test('mede credencial válida com header OAuth e sem divulgar token', async () => {
  const home = mkdtempSync(join(tmpdir(), 'medida-'))
  try {
    mkdirSync(join(home, '.claude-work'))
    writeFileSync(join(home, '.claude-work', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt: 2000000 } }))
    const fetchFalso: typeof fetch = async (url, opts) => {
      assert.equal(url, 'https://api.anthropic.com/api/oauth/usage')
      assert.equal(new Headers(opts?.headers).get('anthropic-beta'), 'oauth-2025-04-20')
      assert.equal(new Headers(opts?.headers).get('Authorization'), `Bearer ${token}`)
      return Response.json({ five_hour: { utilization: 21.5 }, seven_day: { utilization: 41, resets_at: '2026-11-06T23:00:00Z' } })
    }
    const medida = await medirClaude(conta, { home, agora: 1_000_000, fetch: fetchFalso })
    assert.deepEqual(medida, { conta: 'main', curta: 22, longa: 41, resetLongaTs: 1794006000000, estado: 'ok', medidaTs: 1_000_000 })
    assert.equal(JSON.stringify(medida).includes(token), false)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

const deslogado = async () => `Not logged in · Please run /login ${token}`
const semStatus = async () => ''

test('ausente, vencida e 401 com /usage deslogado resultam em sem_login sem cota antiga', async () => {
  const home = mkdtempSync(join(tmpdir(), 'medida-'))
  try {
    mkdirSync(join(home, '.claude-work'))
    for (const expiresAt of [null, 0, 900000, 2000000]) {
      if (expiresAt !== null) writeFileSync(join(home, '.claude-work', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: 'valido', expiresAt } }))
      const medida = await medirClaude(conta, { home, agora: 1_000_000, fetch: async () => new Response(token, { status: 401 }), executarUsage: deslogado, executarStatus: semStatus })
      assert.equal(medida.estado, 'sem_login')
      assert.equal(medida.curta, null)
      assert.equal(medida.longa, null)
      assert.equal(medida.acao, `CLAUDE_CONFIG_DIR=${join(home, '.claude-work')} claude auth login`)
      assert.equal(JSON.stringify(medida).includes(token), false)
    }
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('token vencido, 401 ou credencial fora do arquivo medem pelo /usage em vez de sem_login', async () => {
  const home = mkdtempSync(join(tmpdir(), 'medida-'))
  try {
    mkdirSync(join(home, '.claude-work'))
    const usage = async () => 'Current session: 12% used\nCurrent week (all models): 49% used'
    const d = { home, agora: 1_000_000, executarUsage: usage }
    // macOS: credencial no Keychain, sem arquivo
    assert.equal((await medirClaude(conta, { ...d, fetch: async () => { throw new Error('sem rede') } })).longa, 49)
    for (const expiresAt of [900000, 2000000]) {
      writeFileSync(join(home, '.claude-work', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: 'valido', expiresAt } }))
      const medida = await medirClaude(conta, { ...d, fetch: async () => new Response(token, { status: 401 }) })
      assert.deepEqual([medida.estado, medida.curta, medida.longa], ['ok', 12, 49])
    }
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('sem prova de deslogada a conta é erro, não sem_login; claude auth status loggedIn:false prova', async () => {
  const home = mkdtempSync(join(tmpdir(), 'medida-'))
  try {
    mkdirSync(join(home, '.claude-work'))
    const d = { home, agora: 1_000_000, fetch: (async () => { throw new Error('sem rede') }) as typeof fetch, executarUsage: async () => '' }
    const incerta = await medirClaude(conta, { ...d, executarStatus: async () => '{"loggedIn":true}' })
    assert.deepEqual([incerta.estado, incerta.erro], ['erro', 'claude_usage_unavailable'])
    assert.equal((await medirClaude(conta, { ...d, executarStatus: semStatus })).estado, 'erro')
    assert.equal((await medirClaude(conta, { ...d, executarStatus: async () => '{"loggedIn":false}' })).estado, 'sem_login')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('fallback reconhece conta deslogada sem copiar a saída externa', async () => {
  const home = mkdtempSync(join(tmpdir(), 'medida-'))
  try {
    mkdirSync(join(home, '.claude-work'))
    writeFileSync(join(home, '.claude-work', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt: 2000000 } }))
    const d = { home, agora: 1_000_000, fetch: (async () => { throw new Error(token) }) as typeof fetch }
    const medida = await medirClaude(conta, { ...d, executarUsage: async () => `Not logged in · Please run /login ${token}` })
    assert.equal(medida.estado, 'sem_login')
    assert.ok(medida.acao)
    assert.equal(JSON.stringify(medida).includes(token), false)
    const fallback = await medirClaude(conta, { ...d, executarUsage: async () => 'Current session: 12% used\nCurrent week (all models): 49% used' })
    assert.equal(fallback.estado, 'ok')
    assert.equal(fallback.curta, 12)
    assert.equal(fallback.longa, 49)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('executor real: saída de conta deslogada com código 1 ainda chega à medida', async () => {
  const home = mkdtempSync(join(tmpdir(), 'medida-'))
  try {
    mkdirSync(join(home, '.claude-work'))
    const falso = (saida: string) => (dir: string) => claude(dir, ['-e', `process.stdout.write(${JSON.stringify(saida)});process.exit(1)`], process.execPath)
    const d = { home, agora: 1_000_000, fetch: (async () => { throw new Error('sem rede') }) as typeof fetch }
    const porStatus = await medirClaude(conta, { ...d, executarUsage: falso(''), executarStatus: falso('{"loggedIn": false}') })
    assert.equal(porStatus.estado, 'sem_login')
    assert.match(porStatus.acao ?? '', /claude auth login/)
    const porUsage = await medirClaude(conta, { ...d, executarUsage: falso('Not logged in · Please run /login'), executarStatus: falso('') })
    assert.equal(porUsage.estado, 'sem_login')
    assert.match(porUsage.acao ?? '', /claude auth login/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
