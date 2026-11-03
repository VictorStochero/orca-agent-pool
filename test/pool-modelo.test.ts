import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { limiteDoModelo, medidaEfetiva, modeloEfetivo } from '../src/core/pool/modelo.ts'
import type { Medida } from '../src/core/tipos.ts'
import { conta } from './helpers/pool.ts'

const m = (extra: Partial<Medida> = {}): Medida => ({ conta: 'a', curta: 10, longa: 55, resetLongaTs: null, estado: 'ok', medidaTs: 1, ...extra })

describe('limiteDoModelo', () => {
  it('nomes por agente e modelo', () => {
    assert.equal(limiteDoModelo('claude', 'claude-fable-5-1'), 'Fable')
    assert.equal(limiteDoModelo('antigravity', 'gemini-4-argon-high'), 'Gemini 4 Argon')
    assert.equal(limiteDoModelo('antigravity', 'gemini-3.8-flash-high'), 'Gemini Models')
    assert.equal(limiteDoModelo('antigravity', 'gemini-pro'), 'Gemini Models')
    assert.equal(limiteDoModelo('antigravity', 'claude-opus-5-5-high'), 'Claude and GPT models')
    assert.equal(limiteDoModelo('antigravity', 'gpt-oss-120b-medium'), 'Claude and GPT models')
  })
  it('desconhecido, agente sem tabela e sem modelo: limite geral', () => {
    assert.equal(limiteDoModelo('antigravity', 'qwen'), null)
    assert.equal(limiteDoModelo('codex', 'gpt-fable'), null)
    assert.equal(limiteDoModelo('claude', 'claude-opus-5'), null)
    assert.equal(limiteDoModelo('claude', null), null)
  })
})

describe('modeloEfetivo e medidaEfetiva', () => {
  const limites = [{ nome: 'Gemini Models', curta: 0, longa: 0 }, { nome: 'Gemini 4 Argon', curta: null, longa: 55 }]
  it('antigravity sem modelo usa o padrão Flash', () => {
    const agy = conta('agy', { agente: 'antigravity' })
    assert.equal(modeloEfetivo(agy), 'gemini-3.8-flash-high')
    assert.equal(modeloEfetivo(conta('agy', { agente: 'antigravity', modelo: 'gemini-4-argon-low' })), 'gemini-4-argon-low')
    assert.equal(modeloEfetivo(conta('c')), null)
    const r = medidaEfetiva(agy, m({ limites }))
    assert.deepEqual([r.curta, r.longa], [0, 0])
  })
  it('limite deduzido ausente: fica o geral; nome sem diferenciar maiúsculas', () => {
    const agy = conta('agy', { agente: 'antigravity' })
    assert.deepEqual([medidaEfetiva(agy, m()).curta, medidaEfetiva(agy, m()).longa], [10, 55])
    assert.equal(medidaEfetiva(agy, m({ limites: [{ nome: 'GEMINI MODELS', curta: 1, longa: 2 }] })).longa, 2)
  })
  it('claude com Fable segue o Fable; sem modelo, igual a hoje', () => {
    const fable = [{ nome: 'Fable', curta: null, longa: 29 }]
    assert.equal(medidaEfetiva(conta('c', { modelo: 'claude-fable-5-1' }), m({ limites: fable })).longa, 29)
    assert.equal(medidaEfetiva(conta('c'), m({ limites: fable })).longa, 55)
  })
  it('janela que o limite separado não tem fica a geral (a sessão de 5h vale para todos os modelos)', () => {
    const r = medidaEfetiva(conta('c', { modelo: 'claude-fable-5-1' }), m({ curta: 85, limites: [{ nome: 'Fable', curta: null, longa: 29 }] }))
    assert.deepEqual([r.curta, r.longa], [85, 29])
  })
})
