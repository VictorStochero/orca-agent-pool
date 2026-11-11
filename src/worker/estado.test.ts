import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PADRAO } from '../core/config.ts'
import { paths } from '../core/paths.ts'
import type { Medida } from '../core/tipos.ts'
import { publicar } from '../core/trava.ts'
import { AMBIENTE_VAZIO, montarEstado } from './estado.ts'

test('Orca ainda não verificado não gera alerta; fora do ar gera', async () => {
  const home = mkdtempSync(join(tmpdir(), 'estado-'))
  try {
    const c = structuredClone(PADRAO)
    const inicial = await montarEstado(paths(home), c, null, AMBIENTE_VAZIO)
    assert.equal(inicial.saude.orca.rodando, null)
    assert.equal(
      inicial.alertas.some(a => a.codigo === 'orca_indisponivel'),
      false,
    )
    const fora = await montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, orca: { rodando: false, versao: null } })
    assert.equal(
      fora.alertas.some(a => a.codigo === 'orca_indisponivel'),
      true,
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('cota: medidaTs em ms (unidade do pool) dá "há N min" e marca medida antiga', async () => {
  const home = mkdtempSync(join(tmpdir(), 'estado-'))
  try {
    const c = structuredClone(PADRAO)
    c.pool.contas.push({
      nome: 'a',
      agente: 'claude',
      config: null,
      comando: null,
      modelo: null,
      vagas: 1,
      peso: 1,
      papeis: [],
      ativo: true,
      origem: 'manual',
    })
    const agora = 1_800_000_000_000
    const m = (min: number): Medida => ({
      conta: 'a',
      curta: 90,
      longa: 10,
      resetLongaTs: null,
      estado: 'ok',
      medidaTs: agora - min * 60_000,
    })
    const nova = (await montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, medidas: [m(2)] }, agora)).pool.contas[0].cota
    assert.equal(nova?.medida_ha_min, 2)
    assert.equal(nova?.estado, 'ok')
    assert.equal(nova?.alerta_curta, true)
    assert.equal(nova?.alerta_longa, false)
    const noTeto = (await montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, medidas: [{ ...m(2), curta: 80 }] }, agora)).pool
      .contas[0].cota
    assert.equal(noTeto?.alerta_curta, false)
    const velha = (await montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, medidas: [m(40)] }, agora)).pool.contas[0].cota
    assert.equal(velha?.estado, 'antiga')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('cota: limites separados passam para a cota; ausentes viram lista vazia', async () => {
  const home = mkdtempSync(join(tmpdir(), 'estado-'))
  try {
    const c = structuredClone(PADRAO)
    c.pool.contas.push({
      nome: 'a',
      agente: 'antigravity',
      config: null,
      comando: null,
      modelo: null,
      vagas: 1,
      peso: 1,
      papeis: [],
      ativo: true,
      origem: 'orca',
    })
    const limites = [
      { nome: 'Gemini', curta: 80, longa: 10 },
      { nome: 'Argon', curta: null, longa: 79 },
    ]
    const m: Medida = { conta: 'a', curta: 0, longa: 0, resetLongaTs: null, estado: 'ok', medidaTs: 1, limites }
    const cota = (await montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, medidas: [m] }, 1)).pool.contas[0].cota
    assert.deepEqual(cota?.limites, limites)
    delete m.limites
    assert.deepEqual((await montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, medidas: [m] }, 1)).pool.contas[0].cota?.limites, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('sessões: conta Claude manual lista as abertas; as demais ficam null; o total não repete a mesma pasta', async () => {
  const home = mkdtempSync(join(tmpdir(), 'estado-'))
  try {
    for (const [pasta, nome] of [
      ['.claude', 'um'],
      ['.claude-b', 'dois'],
    ]) {
      mkdirSync(join(home, pasta, 'sessions'), { recursive: true })
      writeFileSync(
        join(home, pasta, 'sessions', '1.json'),
        JSON.stringify({ pid: process.pid, kind: 'interactive', name: nome, cwd: 'C:\\x', status: 'idle' }),
      )
    }
    const c = structuredClone(PADRAO)
    const base = { comando: null, modelo: null, vagas: 1, peso: 1, papeis: [], ativo: true }
    c.pool.contas.push(
      { ...base, nome: 'a', agente: 'claude', config: null, origem: 'manual' },
      { ...base, nome: 'a2', agente: 'claude', config: '~/.claude/', origem: 'manual' },
      { ...base, nome: 'a3', agente: 'claude', config: join(home, '.claude').replaceAll('\\', '/'), origem: 'manual' },
      { ...base, nome: 'b', agente: 'claude', config: '~/.claude-b', origem: 'manual' },
      { ...base, nome: 'o', agente: 'claude', config: null, origem: 'orca' },
      { ...base, nome: 'x', agente: 'codex', config: null, origem: 'manual' },
    )
    const e = await montarEstado(paths(home), c, null, AMBIENTE_VAZIO, 1)
    const por = Object.fromEntries(e.pool.contas.map(ct => [ct.nome, ct.sessoes]))
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

test('agente vivo: usadas é a ocupação do pool e a conta lista os agentes; sem sessões fica null', async () => {
  const home = mkdtempSync(join(tmpdir(), 'estado-'))
  try {
    mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
    for (const [i, agent] of [
      [1, 'fluxo-orca:escritor'],
      [2, 'fluxo-orca:revisor'],
      [3, undefined],
    ] as const) {
      writeFileSync(
        join(home, '.claude', 'sessions', `${i}.json`),
        JSON.stringify({ pid: process.pid, kind: 'interactive', name: `s${i}`, agent }),
      )
    }
    const c = structuredClone(PADRAO)
    const base = { comando: null, modelo: null, vagas: 3, peso: 1, papeis: [], ativo: true }
    c.pool.contas.push(
      { ...base, nome: 'a', agente: 'claude', config: null, origem: 'manual' },
      { ...base, nome: 'x', agente: 'codex', config: null, origem: 'manual' },
    )
    const e = await montarEstado(paths(home), c, null, AMBIENTE_VAZIO, 1)
    const [a, x] = e.pool.contas
    assert.equal(a.usadas, 2)
    assert.deepEqual(a.agentes, ['s1', 's2'])
    assert.deepEqual(a.ocupantes, [])
    assert.equal(x.usadas, 0)
    assert.equal(x.agentes, null)
    assert.equal(e.pool.maquina.usadas, 2)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('cota e alertas seguem o limite do modelo da conta; modelo e limite seguido vão na conta', async () => {
  const home = mkdtempSync(join(tmpdir(), 'estado-'))
  try {
    const c = structuredClone(PADRAO)
    c.pool.contas.push({
      nome: 'agy',
      agente: 'antigravity',
      config: null,
      comando: null,
      modelo: null,
      vagas: 1,
      peso: 1,
      papeis: [],
      ativo: true,
      origem: 'orca',
    })
    c.pool.contas.push({
      nome: 'cl',
      agente: 'claude',
      config: null,
      comando: null,
      modelo: null,
      vagas: 1,
      peso: 1,
      papeis: [],
      ativo: true,
      origem: 'manual',
    })
    const limites = [
      { nome: 'Gemini Models', curta: 0, longa: 0 },
      { nome: 'Gemini 4 Argon', curta: null, longa: 90 },
    ]
    const agy: Medida = { conta: 'agy', curta: 0, longa: 90, resetLongaTs: null, estado: 'ok', medidaTs: 1, limites }
    const cl: Medida = { conta: 'cl', curta: 1, longa: 2, resetLongaTs: null, estado: 'ok', medidaTs: 1 }
    const [a, b] = (await montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, medidas: [agy, cl] }, 1)).pool.contas
    assert.deepEqual(
      [a.cota?.longa, a.cota?.alerta_longa, a.modelo_efetivo, a.limite_seguido],
      [0, false, 'gemini-3.8-flash-high', 'Gemini Models'],
    )
    assert.deepEqual([b.cota?.longa, b.modelo_efetivo, b.limite_seguido], [2, null, null])
    c.pool.contas[0].modelo = 'gemini-4-argon-high'
    const [argon] = (await montarEstado(paths(home), c, null, { ...AMBIENTE_VAZIO, medidas: [agy] }, 1)).pool.contas
    assert.deepEqual([argon.cota?.longa, argon.cota?.alerta_longa, argon.limite_seguido], [90, true, 'Gemini 4 Argon'])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

/** Estado com um teste em execução (trava do próprio processo) iniciado em `desdeTs` e, opcionalmente, com saída em `saidaTs`. */
async function estadoComTeste(semSaidaMin: number | undefined, desdeTs: number, saidaTs: number | null, agora: number, filhoTs?: number) {
  const home = mkdtempSync(join(tmpdir(), 'estado-'))
  try {
    const p = paths(home)
    const c = structuredClone(PADRAO)
    if (semSaidaMin !== undefined) c.fila.semSaidaMin = semSaidaMin
    const saida = saidaTs === null ? undefined : { ts: saidaTs, linha: 'x', linhas: 1, pct: null, feitos: null, total: null }
    publicar(join(p.fila, 'global', '1'), {
      pid: process.pid,
      inicio: desdeTs,
      projeto: 'marco1',
      fila: 'global',
      saida,
      filho: filhoTs === undefined ? undefined : { pid: process.pid, inicio: filhoTs },
    })
    return (await montarEstado(p, c, null, AMBIENTE_VAZIO, agora)).alertas.filter(a => a.codigo === 'teste_sem_saida')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

test('teste_sem_saida: aparece acima do limite, com minutos inteiros e onde', async () => {
  const agora = 1_800_000_000_000
  const a = await estadoComTeste(5, agora - 3_600_000, agora - 7 * 60_000 - 5_000, agora)
  assert.deepEqual(a, [{ codigo: 'teste_sem_saida', nivel: 'aviso', params: { pid: process.pid, onde: 'marco1', min: 7 } }])
})

test('teste_sem_saida: não aparece abaixo do limite, com 0 nem com o padrão ainda dentro de 5 min', async () => {
  const agora = 1_800_000_000_000
  assert.deepEqual(await estadoComTeste(5, agora - 3_600_000, agora - 4 * 60_000, agora), [])
  assert.deepEqual(await estadoComTeste(0, agora - 3_600_000, agora - 600 * 60_000, agora), [])
  assert.deepEqual(await estadoComTeste(undefined, agora - 3_600_000, agora - 4 * 60_000, agora), [])
})

test('teste_sem_saida: sem saida conta do início do processo, não da espera pelo teto', async () => {
  const agora = 1_800_000_000_000
  assert.deepEqual(await estadoComTeste(5, agora - 6 * 60_000, null, agora, agora - 60_000), [])
  assert.equal((await estadoComTeste(5, agora - 60_000, null, agora, agora - 6 * 60_000)).length, 1)
})

test('teste_sem_saida: sem saida e sem filho usa o início da trava', async () => {
  const agora = 1_800_000_000_000
  assert.equal((await estadoComTeste(5, agora - 6 * 60_000, null, agora)).length, 1)
  assert.equal((await estadoComTeste(5, agora - 2 * 60_000, null, agora)).length, 0)
})
