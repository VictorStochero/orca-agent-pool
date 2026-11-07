import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { test } from 'node:test'
import { agentesVivos, procStartMs, sessoesAbertas } from '../src/core/sessoes.ts'
import { arquivos, pidMorto, tmp } from './fila-util.ts'

const sessao = (o: Record<string, unknown>) => JSON.stringify(o)

test('conta só sessão interativa com pid vivo', () => {
  const dir = tmp('sessoes-')
  try {
    arquivos(dir, {
      'sessions/1.json': sessao({ pid: process.pid, kind: 'interactive', name: 'viva', cwd: 'C:\\x', status: 'busy' }),
      'sessions/2.json': sessao({ pid: pidMorto(), kind: 'interactive', name: 'morta' }),
      'sessions/3.json': sessao({ pid: process.pid, kind: 'headless', name: 'outra' }),
    })
    assert.deepEqual(sessoesAbertas(dir), ['viva'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('agentesVivos lista só sessão viva, interativa e com agent', async () => {
  const dir = tmp('sessoes-')
  try {
    arquivos(dir, {
      'sessions/1.json': sessao({ pid: process.pid, kind: 'interactive', name: 'escritor-1', agent: 'fluxo-orca:escritor' }),
      'sessions/2.json': sessao({ pid: process.pid, kind: 'interactive', name: 'coordenador' }),
      'sessions/3.json': sessao({ pid: process.pid, kind: 'interactive', name: 'vazio', agent: '' }),
      'sessions/4.json': sessao({ pid: pidMorto(), kind: 'interactive', name: 'morto', agent: 'x:y' }),
      'sessions/5.json': sessao({ pid: process.pid, kind: 'headless', name: 'headless', agent: 'x:y' }),
    })
    assert.deepEqual(await agentesVivos(dir), ['escritor-1'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pasta ausente dá lista vazia', () => {
  const dir = tmp('sessoes-')
  try {
    assert.deepEqual(sessoesAbertas(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('JSON inválido e arquivo sem pid inteiro positivo são ignorados', () => {
  const dir = tmp('sessoes-')
  try {
    arquivos(dir, {
      'sessions/a.json': '{não é json',
      'sessions/b.json': sessao({ kind: 'interactive', name: 'sem-pid' }),
      'sessions/c.json': sessao({ pid: 'abc', kind: 'interactive' }),
      'sessions/d.json': sessao({ pid: 0, kind: 'interactive' }),
      'sessions/e.json': sessao({ pid: -1, kind: 'interactive' }),
    })
    assert.deepEqual(
      sessoesAbertas(dir, () => true),
      [],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sem name o nome é o pid', () => {
  const dir = tmp('sessoes-')
  try {
    arquivos(dir, { 'sessions/1.json': sessao({ pid: process.pid, kind: 'interactive' }) })
    assert.deepEqual(sessoesAbertas(dir), [String(process.pid)])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const filetime = (ms: number) => String((BigInt(ms) + 11644473600000n) * 10000n)

test('procStartMs converte o FILETIME do Claude Code para ms Unix', () => {
  assert.equal(procStartMs('134381993433620932'), 1793725743362)
  assert.equal(procStartMs('abc'), null)
  assert.equal(procStartMs(undefined), null)
})

test('agentesVivos confere procStart em uma consulta em lote: o que não bate fica fora, o que bate entra', async () => {
  const dir = tmp('sessoes-')
  try {
    const T = 1_710_000_000_000
    arquivos(dir, {
      'sessions/1.json': sessao({ pid: process.pid, kind: 'interactive', name: 'bate', agent: 'x:y', procStart: filetime(T) }),
      'sessions/2.json': sessao({ pid: process.pid + 1, kind: 'interactive', name: 'reaproveitado', agent: 'x:y', procStart: filetime(T) }),
    })
    const chamadas: number[][] = []
    const consulta = async (pids: number[]) => {
      chamadas.push(pids)
      return new Map([
        [process.pid, T + 900],
        [process.pid + 1, T + 3_600_000],
      ])
    }
    assert.deepEqual(await agentesVivos(dir, () => true, consulta), ['bate'])
    assert.equal(chamadas.length, 1)
    assert.deepEqual(chamadas[0].sort(), [process.pid, process.pid + 1].sort())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('agentesVivos: consulta que falha conta a sessão por 15 s, sem repetir a consulta, e não fica definitiva', async t => {
  const dir = tmp('sessoes-')
  t.mock.timers.enable({ apis: ['Date'], now: 2_000_000_000_000 })
  try {
    const T = 1_720_000_000_000
    arquivos(dir, { 'sessions/1.json': sessao({ pid: process.pid, kind: 'interactive', name: 'a', agent: 'x:y', procStart: filetime(T) }) })
    assert.deepEqual(
      await agentesVivos(
        dir,
        () => true,
        async () => null,
      ),
      ['a'],
    )
    t.mock.timers.tick(14_000)
    const proibida = async () => {
      throw new Error('não deveria consultar')
    }
    assert.deepEqual(await agentesVivos(dir, () => true, proibida), ['a'])
    t.mock.timers.tick(1_500)
    assert.deepEqual(
      await agentesVivos(
        dir,
        () => true,
        async () => new Map([[process.pid, T + 5_000_000]]),
      ),
      [],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('agentesVivos: o prazo de 15 s conta da hora depois da consulta, mesmo que ela demore', async t => {
  const dir = tmp('sessoes-')
  t.mock.timers.enable({ apis: ['Date'], now: 2_100_000_000_000 })
  try {
    const T = 1_740_000_000_000
    arquivos(dir, { 'sessions/1.json': sessao({ pid: process.pid, kind: 'interactive', name: 'a', agent: 'x:y', procStart: filetime(T) }) })
    const lenta = (r: Map<number, number> | null) => async () => {
      t.mock.timers.tick(10_000)
      return r
    }
    assert.deepEqual(await agentesVivos(dir, () => true, lenta(null)), ['a'])
    t.mock.timers.tick(10_000)
    const proibida = async () => {
      throw new Error('não deveria consultar')
    }
    assert.deepEqual(await agentesVivos(dir, () => true, proibida), ['a'])

    const T2 = 1_750_000_000_000
    arquivos(dir, {
      'sessions/1.json': sessao({ pid: process.pid, kind: 'interactive', name: 'b', agent: 'x:y', procStart: filetime(T2) }),
    })
    assert.deepEqual(await agentesVivos(dir, () => true, lenta(new Map([[process.pid, T2]]))), ['b'])
    t.mock.timers.tick(10_000)
    assert.deepEqual(await agentesVivos(dir, () => true, proibida), ['b'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('agentesVivos: sem procStart legível conta pelo pid vivo, sem consultar', async () => {
  const dir = tmp('sessoes-')
  try {
    arquivos(dir, {
      'sessions/1.json': sessao({ pid: process.pid, kind: 'interactive', name: 'sem', agent: 'x:y' }),
      'sessions/2.json': sessao({ pid: process.pid + 1, kind: 'interactive', name: 'lixo', agent: 'x:y', procStart: 'abc' }),
    })
    const consulta = async () => {
      throw new Error('não deveria consultar')
    }
    assert.deepEqual((await agentesVivos(dir, () => true, consulta)).sort(), ['lixo', 'sem'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('agentesVivos: procStart que bate vale no cache sem nova consulta', async () => {
  const dir = tmp('sessoes-')
  try {
    const T = 1_730_000_000_000
    arquivos(dir, { 'sessions/1.json': sessao({ pid: process.pid, kind: 'interactive', name: 'a', agent: 'x:y', procStart: filetime(T) }) })
    let n = 0
    const consulta = async () => {
      n++
      return new Map([[process.pid, T]])
    }
    await agentesVivos(dir, () => true, consulta)
    assert.deepEqual(await agentesVivos(dir, () => true, consulta), ['a'])
    assert.equal(n, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
