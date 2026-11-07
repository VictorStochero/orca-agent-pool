import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { cfg, conta } from '../../test/helpers/pool.ts'
import { medirTodas } from '../core/medidas/cache.ts'
import { paths } from '../core/paths.ts'
import { montarEstado } from './estado.ts'

test('conta Claude deslogada: medidor -> cache sem_login com acao -> estado com alerta e 5h/Semanal nulos', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sem-login-'))
  try {
    const p = paths(home)
    mkdirSync(join(home, '.claude-work'))
    const c = cfg([conta('work', { config: '~/.claude-work' })])
    const orca = { run: async () => ({ code: 1, stdout: '', stderr: '' }) }
    const d = {
      home,
      agora: 1_700_000_000_000,
      executarUsage: async () => 'Not logged in',
      fetch: (async () => {
        throw new Error('não deveria medir sem credencial')
      }) as typeof fetch,
    }
    const medidas = await medirTodas(c, p, orca, d)
    assert.equal(medidas[0].estado, 'sem_login')
    assert.match(medidas[0].acao ?? '', /claude auth login/)
    // segunda passada: servida do cache, sem perder o estado nem a ação
    const cache = await medirTodas(c, p, orca, { ...d, agora: d.agora + 60_000 })
    assert.deepEqual(cache, medidas)
    const e = await montarEstado(
      p,
      c,
      null,
      { medidas: cache, detectadas: [], ramGb: null, orca: { rodando: true, versao: null } },
      d.agora + 60_000,
    )
    const cota = e.pool.contas[0].cota!
    assert.deepEqual([cota.estado, cota.curta, cota.longa], ['sem_login', null, null])
    assert.match(cota.acao ?? '', /claude auth login/)
    assert.ok(
      e.alertas.some(
        a => a.codigo === 'sem_login' && a.nivel === 'erro' && a.params?.conta === 'work' && /claude auth login/.test(a.acao ?? ''),
      ),
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('medição só das contas da config: conta removida no cache não dispara medição nem volta', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sem-login-'))
  try {
    const p = paths(home)
    const orca = { run: async () => ({ code: 1, stdout: '', stderr: '' }) }
    let chamadas = 0
    const d = {
      home,
      agora: 1_700_000_000_000,
      fetch: (async () => {
        chamadas++
        throw new Error('x')
      }) as typeof fetch,
    }
    await medirTodas(cfg([conta('a', { config: '~/.claude-a' }), conta('x', { config: '~/.claude-x' })]), p, orca, d)
    const antes = chamadas
    const so = await medirTodas(cfg([conta('a', { config: '~/.claude-a' })]), p, orca, { ...d, agora: d.agora + 10_000 })
    assert.deepEqual(
      so.map(m => m.conta),
      ['a'],
    )
    assert.equal(chamadas, antes)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
