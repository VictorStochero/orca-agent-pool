import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { paths } from '../src/core/paths.ts'
import { encerradoNoOrca, livres, ocupadasMaquina, pegar, recuperar, soltar, trocar } from '../src/core/pool/vagas.ts'
import type { OrcaCli } from '../src/core/tipos.ts'
import { cfg, conta } from './helpers/pool.ts'
import { envCasa } from './helpers/casa.ts'

const homes: string[] = []
function novoHome() {
  const h = mkdtempSync(join(tmpdir(), 'pool-vagas-'))
  homes.push(h)
  return { h, p: paths(h) }
}
after(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })))

describe('vagas', () => {
  it('pega até o total e depois diz cheio; mesmo dono é idempotente', () => {
    const { p } = novoHome(), c = cfg([conta('a', { vagas: 2 })])
    assert.equal(pegar(p, c, 'a', 'ctx_1'), 'ok')
    assert.equal(pegar(p, c, 'a', 'ctx_1'), 'ok')
    assert.equal(pegar(p, c, 'a', 'ctx_2'), 'ok')
    assert.equal(pegar(p, c, 'a', 'ctx_3'), 'cheio')
    assert.deepEqual(livres(p, c), [{ conta: 'a', livres: 0, ocupadas: 2, total: 2, inativa: false }])
  })

  it('inativa devolve inativa; conta desconhecida e dono inválido lançam', () => {
    const { p } = novoHome(), c = cfg([conta('a', { ativo: false })])
    assert.equal(pegar(p, c, 'a', 'ctx_1'), 'inativa')
    assert.deepEqual(livres(p, c), [{ conta: 'a', livres: 0, ocupadas: 0, total: 2, inativa: true }])
    assert.throws(() => pegar(p, c, 'x', 'ctx_1'), /desconhecida/)
    assert.throws(() => pegar(p, c, 'a', '../ruim'), /dono/)
  })

  it('teto da máquina vale entre contas; conta sem limite usa o teto', () => {
    const { p } = novoHome(), c = cfg([conta('a', { vagas: 5 }), conta('b', { vagas: 0 })], { teto: 2 })
    assert.equal(pegar(p, c, 'a', 'ctx_1'), 'ok')
    assert.equal(pegar(p, c, 'b', 'ctx_2'), 'ok')
    assert.equal(pegar(p, c, 'a', 'ctx_3'), 'cheio')
  })

  it('vagas 0 sem teto nem RAM é ilimitado, grava a ocupação e a troca e a soltura funcionam', () => {
    const { p } = novoHome(), c = cfg([conta('a', { vagas: 0 })])
    assert.equal(pegar(p, c, 'a', 'res-a'), 'ok')
    assert.equal(pegar(p, c, 'a', 'res-b'), 'ok')
    assert.equal(readdirSync(p.vagas).filter((n) => n.includes('.lock')).length, 2)
    assert.equal(ocupadasMaquina(p, c), 2)
    assert.deepEqual(livres(p, c), [{ conta: 'a', livres: 0, ocupadas: 2, total: 0, inativa: false }])
    assert.equal(trocar(p, 'res-a', 'ctx_1'), true)
    soltar(p, 'ctx_1')
    assert.equal(livres(p, c)[0].ocupadas, 1)
  })

  it('RAM abaixo do mínimo recusa com memoria; sem leitura não bloqueia', () => {
    const { p } = novoHome(), c = cfg([conta('a')], { ramMinGb: 3 })
    assert.equal(pegar(p, c, 'a', 'ctx_1', Date.now(), 2.5), 'memoria')
    assert.equal(pegar(p, c, 'a', 'ctx_1', Date.now(), 3), 'ok')
    assert.equal(pegar(p, c, 'a', 'ctx_2', Date.now(), null), 'ok')
  })

  it('troca o dono provisório e solta pelo dispatch', () => {
    const { p } = novoHome(), c = cfg([conta('a', { vagas: 1 })])
    pegar(p, c, 'a', 'res-tag')
    assert.equal(trocar(p, 'res-tag', 'ctx_9'), true)
    assert.equal(trocar(p, 'res-tag', 'ctx_9'), true)
    assert.equal(trocar(p, 'res-outro', 'ctx_8'), false)
    assert.equal(pegar(p, c, 'a', 'ctx_1'), 'cheio')
    soltar(p, 'ctx_9')
    assert.equal(pegar(p, c, 'a', 'ctx_1'), 'ok')
  })

  it('reserva res- expira em 600 s', () => {
    const { p } = novoHome(), c = cfg([conta('a', { vagas: 1 })]), t0 = 1_000_000
    pegar(p, c, 'a', 'res-x', t0)
    assert.equal(pegar(p, c, 'a', 'ctx_1', t0 + 599_000), 'cheio')
    assert.equal(livres(p, c, t0 + 601_000)[0].livres, 1)
    assert.equal(pegar(p, c, 'a', 'ctx_1', t0 + 601_000), 'ok')
  })

  it('recuperar libera só com evidência explícita e não consulta reserva res-', async () => {
    const { p } = novoHome(), c = cfg([conta('a', { vagas: 4 })])
    for (const d of ['ctx_morto', 'ctx_vivo', 'ctx_incerto', 'res-t']) pegar(p, c, 'a', d)
    const consultados: string[] = []
    const n = await recuperar(p, c, async (d) => {
      consultados.push(d)
      return d === 'ctx_morto' ? true : d === 'ctx_vivo' ? false : undefined
    })
    assert.equal(n, 1)
    assert.deepEqual(consultados.sort(), ['ctx_incerto', 'ctx_morto', 'ctx_vivo'])
    assert.equal(livres(p, c)[0].livres, 1)
  })

  it('recuperar expira reserva res- velha', async () => {
    const { p } = novoHome(), c = cfg([conta('a', { vagas: 1 })])
    pegar(p, c, 'a', 'res-x', 1000)
    assert.equal(await recuperar(p, c, async () => undefined, 1000 + 601_000), 1)
  })

  it('duas reservas concorrentes da última vaga: uma ok, outra cheio', async () => {
    const config = cfg([conta('a', { vagas: 1 })])
    for (let rodada = 0; rodada < 4; rodada++) {
      const { h } = novoHome()
      const inicio = String(Date.now() + 700)
      const rodar = (dono: string) =>
        new Promise<string>((resolve, reject) =>
          execFile(
            process.execPath,
            ['--experimental-strip-types', 'test/helpers/pegar-filho.ts', h, JSON.stringify(config), dono, inicio],
            { env: envCasa(h) },
            (e, out, err) => (e ? reject(new Error(err)) : resolve(out))
          )
        )
      const r = (await Promise.all([rodar('ctx_1'), rodar('ctx_2')])).sort()
      assert.deepEqual(r, ['cheio', 'ok'])
    }
  })
})

describe('encerradoNoOrca', () => {
  const orca = (lista: unknown, show?: unknown): OrcaCli => ({
    async run(args) {
      if (args[1] === 'worker-list') return { code: 0, stdout: JSON.stringify(lista), stderr: '' }
      return show === undefined ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: JSON.stringify(show), stderr: '' }
    }
  })
  const lista = { ok: true, result: { workers: [{ dispatchId: 'a', dispatchStatus: 'completed' }, { dispatchId: 'b', dispatchStatus: 'running' }] } }

  it('usa a lista; ausente cai no worker-show; falha de transporte é incerta', async () => {
    const f = encerradoNoOrca(orca(lista, { ok: false, error: { code: 'dispatch_not_found' } }))
    assert.equal(await f('a'), true)
    assert.equal(await f('b'), false)
    assert.equal(await f('c'), true)
    assert.equal(await encerradoNoOrca(orca(lista, { ok: true, result: { dispatch: { id: 'c', status: 'stopped' } } }))('c'), true)
    assert.equal(await encerradoNoOrca(orca(lista, { ok: true, result: { dispatch: { id: 'outro', status: 'stopped' } } }))('c'), undefined)
    assert.equal(await encerradoNoOrca(orca(lista))('c'), undefined)
    assert.equal(await encerradoNoOrca(orca({ ok: false }, { ok: false, error: { code: 'runtime_unavailable' } }))('c'), undefined)
  })
})

describe('teto com conta inativa', () => {
  it('worker vivo em conta marcada inativa continua contando no teto', () => {
    const { p } = novoHome()
    const ativa = cfg([conta('a', { vagas: 5 }), conta('b', { vagas: 5 })], { teto: 1 })
    assert.equal(pegar(p, ativa, 'b', 'ctx_1'), 'ok')
    const inativa = cfg([conta('a', { vagas: 5 }), conta('b', { vagas: 5, ativo: false })], { teto: 1 })
    assert.equal(pegar(p, inativa, 'a', 'ctx_2'), 'cheio')
    assert.equal(ocupadasMaquina(p, inativa), 1)
  })
})
