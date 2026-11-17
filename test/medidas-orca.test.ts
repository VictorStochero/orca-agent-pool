import assert from 'node:assert/strict'
import { test } from 'node:test'
import { medirOrca } from '../src/core/medidas/orca.ts'

test('lê envelope real do Orca e converte reset em segundos sem propagar erro externo', async () => {
  const medidas = await medirOrca({
    run: async args => {
      assert.deepEqual(args, ['account', 'list', '--json'])
      return {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          result: {
            codex: { accounts: [], activeAccountId: null, systemDefault: { hasAuth: true } },
            rateLimits: {
              codex: {
                provider: 'codex',
                session: { usedPercent: 35, windowMinutes: 300, resetsAt: 1793641696000 },
                weekly: { usedPercent: 43, windowMinutes: 10080, resetsAt: 1793797281000 },
                updatedAt: 1793638884703,
                error: null,
                status: 'ok',
              },
              kimi: { provider: 'kimi', session: null, weekly: null, status: 'unavailable', error: 'SECRET' },
              cursor: {
                provider: 'cursor',
                session: null,
                weekly: null,
                status: 'unavailable',
                usageMetadata: { failureKind: 'missing-credentials' },
              },
              minimaxCookieConfigured: false,
            },
          },
        }),
      }
    },
  })
  assert.deepEqual(medidas.get('codex'), { curta: 35, longa: 43, resetLongaTs: 1793797281000, estado: 'ok' })
  assert.equal(medidas.get('kimi')?.estado, 'erro')
  assert.equal(medidas.get('cursor')?.estado, 'sem_login')
  assert.equal(medidas.has('minimaxCookieConfigured'), false)
  assert.equal(JSON.stringify([...medidas]).includes('SECRET'), false)
})

test('Orca sem login não oferece cota mesmo com percentuais velhos', async () => {
  const medidas = await medirOrca({
    run: async () => ({
      code: 0,
      stderr: '',
      stdout: JSON.stringify({
        ok: true,
        result: {
          rateLimits: {
            claude: {
              provider: 'claude',
              status: 'unavailable',
              session: { usedPercent: 10 },
              weekly: { usedPercent: 20 },
              error: 'Not signed in to Claude',
            },
          },
        },
      }),
    }),
  })
  assert.deepEqual(medidas.get('claude'), { curta: null, longa: null, resetLongaTs: null, estado: 'sem_login' })
})

const MAX = Number.MAX_SAFE_INTEGER
const orcaCache = (rateLimits: Record<string, unknown>) => ({
  run: async () => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result: { rateLimits } }) }),
})
const indisponivel = (provider: string, retryAtMs?: number, status = 'unavailable') => ({
  provider,
  session: null,
  weekly: null,
  status,
  error: 'Antigravity usage is not available. Sign in with `agy`, then refresh usage.',
  usageMetadata: {
    source: 'cli',
    failureKind: 'missing-credentials',
    ...(retryAtMs === undefined ? {} : { retryAtMs }),
  },
})

test('entrada congelada do Orca (retryAtMs máximo): sem_login, orca_congelada e comando para conferir o login', async () => {
  const medidas = await medirOrca(orcaCache({ antigravity: indisponivel('antigravity', MAX) }))
  const m = medidas.get('antigravity')
  assert.deepEqual([m?.estado, m?.erro, m?.acao], ['sem_login', 'orca_congelada', 'agy models'])
})

test('provedor congelado sem comando conhecido: orca_congelada sem acao', async () => {
  const m = (await medirOrca(orcaCache({ cursor: indisponivel('cursor', MAX) }))).get('cursor')
  assert.deepEqual([m?.estado, m?.erro], ['sem_login', 'orca_congelada'])
  assert.equal('acao' in (m ?? {}), false)
})

test('missing-credentials com retryAtMs finito ou ausente não é congelada', async () => {
  for (const retry of [Date.now() + 60_000, undefined]) {
    const m = (await medirOrca(orcaCache({ antigravity: indisponivel('antigravity', retry) }))).get('antigravity')
    assert.equal(m?.estado, 'sem_login')
    assert.equal('erro' in (m ?? {}), false)
    assert.equal('acao' in (m ?? {}), false)
  }
})

test('status ok com retryAtMs grande não marca orca_congelada', async () => {
  const m = (await medirOrca(orcaCache({ antigravity: { ...indisponivel('antigravity', MAX, 'ok'), session: { usedPercent: 5 } } }))).get(
    'antigravity',
  )
  assert.equal(m?.estado, 'ok')
  assert.equal('erro' in (m ?? {}), false)
})

test('falhas do CLI e JSON inválido não viram medidas antigas', async () => {
  for (const stdout of ['invalid', '{"ok":false}']) {
    await assert.rejects(medirOrca({ run: async () => ({ code: 0, stdout, stderr: 'SECRET' }) }), /orca/)
  }
})

const orcaCom = (buckets?: unknown) => ({
  run: async () => ({
    code: 0,
    stderr: '',
    stdout: JSON.stringify({
      ok: true,
      result: {
        rateLimits: {
          antigravity: {
            provider: 'antigravity',
            status: 'ok',
            session: { usedPercent: 0 },
            weekly: { usedPercent: 0 },
            ...(buckets ? { buckets } : {}),
          },
        },
      },
    }),
  }),
})
const b = (group: string, windowMinutes: number, usedPercent: number) => ({
  name: `${group} ${windowMinutes}`,
  group,
  windowName: 'w',
  usedPercent,
  windowMinutes,
  resetsAt: 1,
})

test('limites separados: buckets agrupados por group viram curta (300) e longa (10080)', async () => {
  const buckets = [
    b('Gemini Models', 300, 0),
    b('Gemini Models', 10080, 0),
    b('Claude and GPT models', 300, 0),
    b('Claude and GPT models', 10080, 0),
    b('Gemini 4 Argon', 10080, 53),
    b('Gemini 4 Argon', 60, 99),
  ]
  const m = (await medirOrca(orcaCom(buckets))).get('antigravity')
  assert.deepEqual(m?.limites, [
    { nome: 'Gemini Models', curta: 0, longa: 0 },
    { nome: 'Claude and GPT models', curta: 0, longa: 0 },
    { nome: 'Gemini 4 Argon', curta: null, longa: 53 },
  ])
})

test('limites separados: um grupo só, buckets ausentes ou percentual inválido', async () => {
  assert.equal('limites' in ((await medirOrca(orcaCom([b('A', 300, 1), b('A', 10080, 2)]))).get('antigravity') ?? {}), false)
  assert.equal('limites' in ((await medirOrca(orcaCom())).get('antigravity') ?? {}), false)
  const m = (await medirOrca(orcaCom([b('A', 300, 150), b('B', 10080, 7)]))).get('antigravity')
  assert.deepEqual(m?.limites, [
    { nome: 'A', curta: null, longa: null },
    { nome: 'B', curta: null, longa: 7 },
  ])
})
