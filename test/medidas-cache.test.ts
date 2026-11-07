import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { medidasGravadas, medirTodas } from '../src/core/medidas/cache.ts'
import { paths } from '../src/core/paths.ts'
import type { Config } from '../src/core/tipos.ts'
import { envCasa } from './helpers/casa.ts'
import { cfg, conta } from './helpers/pool.ts'

test('cache por conta dura cinco minutos, renova sem cota velha e nunca contém token', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cache-medidas-'))
  try {
    const token = 'TOKEN_SECRETO_DE_TESTE'
    mkdirSync(join(home, '.claude'))
    writeFileSync(
      join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt: 999999999 } }),
    )
    const c: Config = {
      versao: 1,
      pool: {
        teto: 0,
        ramMinGb: 0,
        escolha: 'ritmo',
        contas: [
          {
            nome: '../conta',
            agente: 'claude',
            config: null,
            comando: null,
            modelo: null,
            vagas: 1,
            peso: 1,
            papeis: [],
            ativo: true,
            origem: 'manual',
          },
          {
            nome: 'codex',
            agente: 'codex',
            config: null,
            comando: null,
            modelo: null,
            vagas: 1,
            peso: 1,
            papeis: [],
            ativo: true,
            origem: 'orca',
          },
        ],
      },
      fila: { modo: 'banco', vagas: 2, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 300 },
    }
    let chamadas = 0
    const orca = {
      run: async () => {
        chamadas++
        return {
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            ok: true,
            result: { rateLimits: { codex: { provider: 'codex', status: 'ok', session: { usedPercent: 30 } } } },
          }),
        }
      },
    }
    const d = {
      home,
      agora: 1_000_000,
      executarUsage: async () => 'Not logged in',
      executarStatus: async () => '',
      fetch: (async () => Response.json({ five_hour: { utilization: 12 }, seven_day: { utilization: 45 } })) as typeof fetch,
    }
    const p = paths(home)
    const primeira = await medirTodas(c, p, orca, d)
    assert.equal(primeira[0].longa, 45)
    assert.deepEqual(await medirTodas(c, p, orca, { ...d, agora: 1_299_000 }), primeira)
    assert.equal(chamadas, 1)
    const renovada = await medirTodas(
      c,
      p,
      {
        run: async () => {
          throw new Error(token)
        },
      },
      { ...d, agora: 1_300_000, fetch: async () => new Response(token, { status: 401 }) },
    )
    assert.equal(renovada[0].estado, 'sem_login')
    assert.equal(renovada[0].longa, null)
    assert.equal(renovada[1].estado, 'erro')
    for (const arquivo of readdirSync(p.medidas)) {
      assert.equal(readFileSync(join(p.medidas, arquivo), 'utf8').includes(token), false)
      assert.ok(arquivo.endsWith('.json'))
    }
    assert.equal(JSON.stringify(renovada).includes(token), false)
    const filho = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `
      import { medirClaude } from './src/core/medidas/claude.ts';
      const medida = await medirClaude(${JSON.stringify(c.pool.contas[0])}, { home: ${JSON.stringify(home)}, agora: 1_000_000, fetch: async () => { throw new Error(${JSON.stringify(token)}) }, executarUsage: async () => { throw new Error(${JSON.stringify(token)}) } });
      console.log(JSON.stringify(medida));
    `,
      ],
      { encoding: 'utf8', cwd: process.cwd(), env: envCasa(home) },
    )
    assert.equal(filho.status, 0)
    assert.equal((filho.stdout + filho.stderr).includes(token), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a chamada publica as medidas juntas depois de concluir a coleta', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cache-medidas-'))
  try {
    mkdirSync(join(home, '.claude'))
    writeFileSync(
      join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'falso', expiresAt: 999999999 } }),
    )
    const conta = {
      agente: 'claude',
      config: null,
      comando: null,
      modelo: null,
      vagas: 1,
      peso: 1,
      papeis: [],
      ativo: true,
      origem: 'manual' as const,
    }
    const c: Config = {
      versao: 1,
      pool: {
        teto: 0,
        ramMinGb: 0,
        escolha: 'ritmo',
        contas: [
          { ...conta, nome: 'a' },
          { ...conta, nome: 'b' },
        ],
      },
      fila: { modo: 'banco', vagas: 2, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 300 },
    }
    const p = paths(home)
    const orca = { run: async () => ({ code: 0, stdout: '{}', stderr: '' }) }
    await medirTodas(c, p, orca, { home, agora: 1_000_000, fetch: async () => Response.json({ seven_day: { utilization: 10 } }) })
    let chamadas = 0
    let parcial = false
    const novas = await medirTodas(c, p, orca, {
      home,
      agora: 1_300_000,
      fetch: async () => {
        if (++chamadas === 2)
          parcial = readdirSync(p.medidas).some(f => readFileSync(join(p.medidas, f), 'utf8').includes('"medidaTs":1300'))
        return Response.json({ seven_day: { utilization: 20 } })
      },
    })
    assert.equal(parcial, false)
    assert.deepEqual(
      novas.map(m => m.longa),
      [20, 20],
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('medidasGravadas devolve o que está em disco sem limite de idade e descarta forma inválida', () => {
  const home = mkdtempSync(join(tmpdir(), 'cache-medidas-'))
  try {
    const p = paths(home)
    assert.deepEqual(medidasGravadas(p), [])
    mkdirSync(p.medidas, { recursive: true })
    const velha = { conta: 'a', curta: 10, longa: 20, resetLongaTs: null, estado: 'ok', medidaTs: 1 }
    writeFileSync(
      join(p.medidas, 'contas.json'),
      JSON.stringify({ x: velha, y: { ...velha, conta: 'b', curta: 101 }, z: { ...velha, conta: 'c', estado: 'qualquer' }, w: null }),
    )
    assert.deepEqual(medidasGravadas(p), [velha])
    writeFileSync(join(p.medidas, 'contas.json'), '{inválido')
    assert.deepEqual(medidasGravadas(p), [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('limites separados: válidos sobrevivem à gravação; inválidos invalidam a medida; cache sem limites segue válido', () => {
  const home = mkdtempSync(join(tmpdir(), 'cache-limites-'))
  try {
    const p = paths(home)
    mkdirSync(p.medidas, { recursive: true })
    const m = (conta: string, extra: object) => ({ conta, curta: 1, longa: 2, resetLongaTs: null, estado: 'ok', medidaTs: 1, ...extra })
    writeFileSync(
      join(p.medidas, 'contas.json'),
      JSON.stringify({
        a: m('a', { limites: [{ nome: 'Fable', curta: null, longa: 29 }] }),
        b: m('b', {}),
        c: m('c', { limites: [{ nome: 'X', curta: null, longa: 101 }] }),
        d: m('d', { limites: [{ nome: '', curta: 1, longa: 1 }] }),
        e: m('e', { limites: 'x' }),
      }),
    )
    assert.deepEqual(
      medidasGravadas(p).map(x => x.conta),
      ['a', 'b'],
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('medir só uma conta consulta só ela e mantém no cache a medida das outras', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cache-solo-'))
  try {
    mkdirSync(join(home, '.claude'))
    writeFileSync(
      join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: 9_999_999_999_999 } }),
    )
    const c = cfg([conta('a'), conta('b')])
    const p = paths(home)
    let consultas = 0
    const fetchContado = (async () => {
      consultas++
      return Response.json({ five_hour: { utilization: 10 }, seven_day: { utilization: 20 } })
    }) as typeof fetch
    const d = { home, fetch: fetchContado, agora: 1_700_000_000_000 }
    const orca = { run: async () => ({ code: 1, stdout: '', stderr: '' }) }
    await medirTodas(c, p, orca, d, 0)
    assert.equal(consultas, 2)
    const solo = await medirTodas(c, p, orca, d, 0, 'a')
    assert.deepEqual(
      solo.map(m => m.conta),
      ['a'],
    )
    assert.equal(consultas, 3)
    assert.deepEqual(
      medidasGravadas(p)
        .map(m => m.conta)
        .sort(),
      ['a', 'b'],
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
