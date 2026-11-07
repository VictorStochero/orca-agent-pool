import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { atualizarConfig, carregar, PADRAO } from '../src/core/config.ts'
import { aplicar } from '../src/core/config-chaves.ts'
import { limparTravasMortasAsync, listarTestesAsync } from '../src/core/fila/travas.ts'
import { paths } from '../src/core/paths.ts'
import { adquirir, publicar } from '../src/core/trava.ts'
import { consultarProcessos } from '../src/core/win32.ts'
import { pidMorto, tmp } from './fila-util.ts'

test('adquirir: recupera trava de dono morto e desiste, sem travar o processo, quando o dono vive', async () => {
  const dir = join(tmp(), 'trava')
  assert.ok(publicar(dir, { pid: pidMorto() }))
  assert.equal(await adquirir(dir, 1000), true)
  // Com Atomics.wait o processo ficaria parado e o timer só dispararia depois do await.
  let timerDisparou = false
  const timer = setTimeout(() => (timerDisparou = true), 40)
  assert.equal(await adquirir(dir, 200, () => true), false)
  clearTimeout(timer)
  assert.equal(timerDisparou, true)
})

test('atualizarConfig grava sob a trava e a solta', async () => {
  const p = paths(tmp())
  await atualizarConfig(p, c => aplicar(c, { 'fila.vagas': '5' }))
  assert.equal(carregar(p).fila.vagas, 5)
  assert.equal(existsSync(`${p.config}.lock`), false)
  assert.equal(PADRAO.fila.vagas, 2)
})

test('listarTestesAsync marca a trava de dono vivo como execucao e a de dono e filho mortos como parado; a varredura só tira a morta', async () => {
  const p = paths(tmp())
  assert.ok(publicar(join(p.fila, 'global', '1'), { pid: process.pid, inicio: 1 }))
  assert.ok(publicar(join(p.fila, 'global', '2'), { pid: pidMorto(), inicio: 2, filho: { pid: pidMorto(), inicio: 2 } }))
  const estados = (await listarTestesAsync(p)).map(t => [t.vaga, t.estado])
  assert.deepEqual(estados, [
    [1, 'execucao'],
    [2, 'parado'],
  ])
  await limparTravasMortasAsync(p)
  assert.equal(existsSync(join(p.fila, 'global', '1')), true)
  assert.equal(existsSync(join(p.fila, 'global', '2')), false)
})

test('consultarProcessos devolve as linhas da saída ou null quando o filtro falha', {
  skip: process.platform !== 'win32',
}, async () => {
  assert.deepEqual(await consultarProcessos(`ProcessId=${process.pid}`, '$_.ProcessId'), [String(process.pid)])
  assert.equal(await consultarProcessos('isto não é WQL (', '$_.ProcessId'), null)
})

test('limparTravasMortasAsync: dono que morre depois do aquecimento não perde a trava do filho ainda não consultado', {
  skip: process.platform !== 'win32',
}, async () => {
  const p = paths(tmp())
  const dir = join(p.fila, 'global', '1')
  assert.ok(publicar(dir, { pid: 4242, inicio: Date.now(), filho: { pid: pidMorto(), inicio: Date.now() } }))
  // Vivo no aquecimento (nada é consultado), morto na varredura seguinte.
  let consultas = 0
  await limparTravasMortasAsync(p, () => ++consultas === 1)
  assert.equal(existsSync(dir), true)
})
