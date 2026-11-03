import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PADRAO } from '../core/config.ts'
import { paths } from '../core/paths.ts'
import type { Medida } from '../core/tipos.ts'
import { AMBIENTE_VAZIO, montarEstado } from './estado.ts'

test('Orca ainda não verificado não gera alerta; fora do ar gera', () => {
  const home = mkdtempSync(join(tmpdir(), 'estado-'))
  try {
    const c = structuredClone(PADRAO)
    const inicial = montarEstado(paths(home), c, null, AMBIENTE_VAZIO)
    assert.equal(inicial.saude.orca.rodando, null)
    assert.equal(inicial.alertas.some((a) => a.codigo === 'orca_indisponivel'), false)
    const fora = montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, orca: { rodando: false, versao: null } })
    assert.equal(fora.alertas.some((a) => a.codigo === 'orca_indisponivel'), true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('cota: medidaTs em ms (unidade do pool) dá "há N min" e marca medida antiga', () => {
  const home = mkdtempSync(join(tmpdir(), 'estado-'))
  try {
    const c = structuredClone(PADRAO)
    c.pool.contas.push({ nome: 'a', agente: 'claude', config: null, comando: null, vagas: 1, peso: 1, papeis: [], ativo: true, origem: 'manual' })
    const agora = 1_800_000_000_000
    const m = (min: number): Medida => ({ conta: 'a', curta: 90, longa: 10, resetLongaTs: null, estado: 'ok', medidaTs: agora - min * 60_000 })
    const nova = montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, medidas: [m(2)] }, agora).pool.contas[0].cota
    assert.equal(nova?.medida_ha_min, 2)
    assert.equal(nova?.estado, 'ok')
    assert.equal(nova?.alerta_curta, true)
    assert.equal(nova?.alerta_longa, false)
    const velha = montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, medidas: [m(40)] }, agora).pool.contas[0].cota
    assert.equal(velha?.estado, 'antiga')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('cota: limites separados passam para a cota; ausentes viram lista vazia', () => {
  const home = mkdtempSync(join(tmpdir(), 'estado-'))
  try {
    const c = structuredClone(PADRAO)
    c.pool.contas.push({ nome: 'a', agente: 'antigravity', config: null, comando: null, vagas: 1, peso: 1, papeis: [], ativo: true, origem: 'orca' })
    const limites = [{ nome: 'Gemini', curta: 80, longa: 10 }, { nome: 'Argon', curta: null, longa: 79 }]
    const m: Medida = { conta: 'a', curta: 0, longa: 0, resetLongaTs: null, estado: 'ok', medidaTs: 1, limites }
    const cota = montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, medidas: [m] }, 1).pool.contas[0].cota
    assert.deepEqual(cota?.limites, limites)
    delete m.limites
    assert.deepEqual(montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, medidas: [m] }, 1).pool.contas[0].cota?.limites, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('sessões: conta Claude manual lista as abertas; as demais ficam null; o total não repete a mesma pasta', () => {
  const home = mkdtempSync(join(tmpdir(), 'estado-'))
  try {
    for (const [pasta, nome] of [['.claude', 'um'], ['.claude-b', 'dois']]) {
      mkdirSync(join(home, pasta, 'sessions'), { recursive: true })
      writeFileSync(join(home, pasta, 'sessions', '1.json'), JSON.stringify({ pid: process.pid, kind: 'interactive', name: nome, cwd: 'C:\\x', status: 'idle' }))
    }
    const c = structuredClone(PADRAO)
    const base = { comando: null, vagas: 1, peso: 1, papeis: [], ativo: true }
    c.pool.contas.push(
      { ...base, nome: 'a', agente: 'claude', config: null, origem: 'manual' },
      { ...base, nome: 'a2', agente: 'claude', config: '~/.claude/', origem: 'manual' },
      { ...base, nome: 'a3', agente: 'claude', config: join(home, '.claude').replaceAll('\\', '/'), origem: 'manual' },
      { ...base, nome: 'b', agente: 'claude', config: '~/.claude-b', origem: 'manual' },
      { ...base, nome: 'o', agente: 'claude', config: null, origem: 'orca' },
      { ...base, nome: 'x', agente: 'codex', config: null, origem: 'manual' }
    )
    const e = montarEstado(paths(home), c, null, AMBIENTE_VAZIO, 1, home)
    const por = Object.fromEntries(e.pool.contas.map((ct) => [ct.nome, ct.sessoes]))
    assert.deepEqual(por.a, ['um'])
    assert.deepEqual(por.a2, por.a)
    assert.deepEqual(por.a3, por.a)
    assert.equal(por.b?.length, 1)
    assert.equal(por.o, null)
    assert.equal(por.x, null)
    assert.equal(e.pool.sessoes, 2)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
