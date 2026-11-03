import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
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
