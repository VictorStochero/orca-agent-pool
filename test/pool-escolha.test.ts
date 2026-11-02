import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { CATALOGO } from '../src/core/catalogo.ts'
import { paths } from '../src/core/paths.ts'
import { escolherEscritor, escolherSegunda, rankearEscritores } from '../src/core/pool/escolha.ts'
import { medirTodas } from '../src/core/medidas/cache.ts'
import { pegar } from '../src/core/pool/vagas.ts'
import type { Medida } from '../src/core/tipos.ts'
import { cfg, conta } from './helpers/pool.ts'

const raizes: string[] = []
function novoP() {
  const h = mkdtempSync(join(tmpdir(), 'pool-escolha-'))
  raizes.push(h)
  return paths(h)
}
after(() => raizes.forEach((h) => rmSync(h, { recursive: true, force: true })))

const H = 3600_000
const agora = 1_700_000_000_000
const m = (c: string, curta: number | null, longa: number | null, extra: Partial<Medida> = {}): Medida => ({
  conta: c, curta, longa, resetLongaTs: agora + 84 * H, estado: 'ok', medidaTs: agora, ...extra
})

describe('escolherEscritor', () => {
  it('ritmo: cota livre × peso', () => {
    const c = cfg([conta('a', { peso: 1 }), conta('b', { peso: 5 })])
    const r = escolherEscritor(c, [m('a', 10, 20), m('b', 10, 50)], novoP(), agora)
    assert.equal(r?.conta, 'b')
    assert.deepEqual([r!.livre, r!.horas, r!.peso, r!.semMedidor], [50, 84, 5, false])
  })

  it('ritmo premia quem zera antes (mesma cota livre)', () => {
    const c = cfg([conta('a'), conta('b')])
    const r = escolherEscritor(c, [m('a', 10, 40), m('b', 10, 40, { resetLongaTs: agora + 20 * H })], novoP(), agora)
    assert.equal(r?.conta, 'b')
  })

  it('ordem: a primeira apta, ignorando peso', () => {
    const c = cfg([conta('a'), conta('b', { peso: 9 })], { escolha: 'ordem' })
    assert.equal(escolherEscritor(c, [m('a', 10, 70), m('b', 10, 10)], novoP(), agora)?.conta, 'a')
    assert.equal(escolherEscritor(c, [m('a', 10, 90), m('b', 10, 10)], novoP(), agora)?.conta, 'b')
  })

  it('exclui inativa, sem papel, sem_login, erro', () => {
    const c = cfg([
      conta('inativa', { ativo: false }), conta('revisor', { papeis: ['revisor'] }),
      conta('login'), conta('erro'), conta('boa')
    ])
    const ms = [m('inativa', 0, 0), m('revisor', 0, 0), m('login', null, null, { estado: 'sem_login' }),
      m('erro', null, null, { estado: 'erro' }), m('boa', 50, 50)]
    assert.equal(escolherEscritor(c, ms, novoP(), agora)?.conta, 'boa')
    assert.equal(escolherEscritor(cfg([conta('login')]), [ms[2]], novoP(), agora), null)
  })

  it('teto de cota: 80%, ou 95% com reset da longa em menos de 24 h', () => {
    const c = cfg([conta('a')])
    const pick = (cu: number, lo: number, reset: number | null) =>
      escolherEscritor(c, [m('a', cu, lo, { resetLongaTs: reset })], novoP(), agora)
    assert.equal(pick(81, 10, agora + 10 * H), null)
    assert.equal(pick(10, 81, agora + 48 * H), null)
    assert.equal(pick(10, 81, null), null)
    assert.equal(pick(10, 90, agora + 10 * H)?.conta, 'a')
    assert.equal(pick(10, 96, agora + 10 * H), null)
  })

  it('exclui conta sem vaga e máquina cheia', () => {
    const p = novoP()
    const c = cfg([conta('a', { vagas: 1 }), conta('b', { vagas: 1 })])
    pegar(p, c, 'a', 'ctx_1')
    const ms = [m('a', 0, 0), m('b', 50, 50)]
    assert.equal(escolherEscritor(c, ms, p, agora)?.conta, 'b')
    const cheio = cfg(c.pool.contas, { teto: 1 })
    assert.equal(escolherEscritor(cheio, ms, p, agora), null)
  })

  it('sem medidor vem depois das medidas, na ordem da tabela', () => {
    const c = cfg([conta('sm1'), conta('sm2'), conta('med')])
    const ms = [m('sm1', null, null, { estado: 'sem_medida' }), m('med', 70, 70)]
    const r = rankearEscritores(c, ms, novoP(), agora)
    assert.deepEqual(r.map((x) => x.conta), ['med', 'sm1', 'sm2'])
    assert.deepEqual([r[1].conta, r[1].semMedidor, r[1].ritmo], ['sm1', true, null])
  })
})

describe('escolherSegunda', () => {
  const c = cfg([conta('cl', { agente: 'claude' }), conta('gp', { agente: 'codex' }), conta('gm', { agente: 'gemini' })])
  it('outra família, maior folga na longa', () => {
    const ms = [m('cl', 10, 10), m('gp', 10, 30), m('gm', 10, 20)]
    assert.equal(escolherSegunda(c, ms, 'claude', agora, undefined, novoP())?.conta, 'gm')
    assert.equal(escolherSegunda(c, ms, 'gpt', agora, undefined, novoP())?.conta, 'cl')
  })
  it('teto próprio de 60% e exclusões', () => {
    const ms = [m('cl', 10, 10), m('gp', 10, 61), m('gm', 10, 20, { estado: 'sem_login' })]
    assert.equal(escolherSegunda(c, ms, 'claude', agora, undefined, novoP()), null)
    assert.equal(escolherSegunda(c, [m('gp', 10, 61)], 'claude', agora, 70, novoP())?.conta, 'gp')
  })
})

describe('família vem do catálogo', () => {
  it('cada agente do CATALOGO vale como segunda opinião conforme a sua familia', () => {
    for (const a of CATALOGO) {
      const c = cfg([conta('x', { agente: a.id })])
      c.pool.contas[0].papeis = ['segunda-opiniao']
      const esperado = a.familia === 'outro' ? null : 'x'
      assert.equal(escolherSegunda(c, [m('x', 10, 20)], 'nenhuma', agora, undefined, novoP())?.conta ?? null, esperado, a.id)
    }
  })
  it('agente fora do catálogo é família outra: nunca segunda opinião', () => {
    const c = cfg([conta('x', { agente: 'desconhecido', papeis: ['segunda-opiniao'] })])
    assert.equal(escolherSegunda(c, [m('x', 10, 20)], 'claude', agora, undefined, novoP()), null)
  })
})

describe('medidas → escolha', () => {
  it('medirTodas e rankearEscritores falam a mesma unidade (ms): longa 90 com reset em 20 h ainda é elegível', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pool-escolha-'))
    raizes.push(home)
    const reset = new Date(agora + 20 * H).toISOString()
    const c = cfg([conta('a')])
    const fetchFalso: typeof fetch = async () => Response.json({ five_hour: { utilization: 10 }, seven_day: { utilization: 90, resets_at: reset } })
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'x', expiresAt: agora + H } }))
    const medidas = await medirTodas(c, paths(home), { run: async () => ({ code: 1, stdout: '', stderr: '' }) }, { home, fetch: fetchFalso, agora })
    assert.equal(rankearEscritores(c, medidas, paths(home), agora)[0]?.conta, 'a')
  })
})
