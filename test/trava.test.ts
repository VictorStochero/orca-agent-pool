import assert from 'node:assert/strict'
import { closeSync, existsSync, mkdirSync, openSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { soltarVaga } from '../src/core/fila/travas.ts'
import { comTrava, esperar, publicar, TravaOcupada, tirarTravaMorta } from '../src/core/trava.ts'
import { tmp } from './fila-util.ts'

test('tirarTravaMorta só remove se o dono ainda é o esperado e respeita a retirada em curso', () => {
  const base = join(tmp(), 'q')
  const dir = join(base, '1')
  const retirando = join(base, '.retirando-1')
  assert.ok(publicar(dir, { pid: 11 }))
  assert.ok(publicar(retirando, { pid: process.pid }))
  tirarTravaMorta(dir, 11)
  assert.equal(existsSync(dir), true, 'retirada presa por outro: não remove')
  rmSync(retirando, { recursive: true })
  tirarTravaMorta(dir, 99)
  assert.equal(existsSync(dir), true, 'dono trocado: mantém a trava')
  tirarTravaMorta(dir, 11)
  assert.equal(existsSync(dir), false)
  assert.equal(existsSync(retirando), false)
})

test('tirarTravaMorta com dono nulo mantém a pasta recém-criada sem info.json e apaga a velha', () => {
  const dir = join(tmp(), 'q', '1')
  mkdirSync(dir, { recursive: true })
  tirarTravaMorta(dir, null)
  assert.equal(existsSync(dir), true, 'recém-criada: publicação ou soltura em curso')
  const velho = new Date(Date.now() - 60_000)
  utimesSync(dir, velho, velho)
  tirarTravaMorta(dir, null)
  assert.equal(existsSync(dir), false)
})

test('tirarTravaMorta apaga a sobra velha de retirada interrompida', () => {
  const base = join(tmp(), 'q')
  const retirando = join(base, '.retirando-1')
  assert.ok(publicar(retirando, { pid: 11 }))
  const velho = new Date(Date.now() - 60_000)
  utimesSync(retirando, velho, velho)
  tirarTravaMorta(join(base, '1'), null)
  assert.equal(existsSync(retirando), false)
})

test('comTrava solta ao fim, inclusive com erro, e lança TravaOcupada se não consegue', async () => {
  const dir = join(tmp(), 'lock')
  assert.equal(await comTrava(dir, 1000, () => existsSync(dir)), true)
  assert.equal(existsSync(dir), false)
  await assert.rejects(comTrava(dir, 1000, () => assert.fail('x')))
  assert.equal(existsSync(dir), false)
  assert.ok(publicar(dir, { pid: process.pid }))
  await assert.rejects(
    comTrava(dir, 50, () => 1),
    TravaOcupada,
  )
})

test('comTrava mantém a trava até a fn assíncrona terminar', async () => {
  const dir = join(tmp(), 'lock')
  const durante = await comTrava(dir, 1000, async () => {
    await esperar(30)
    return existsSync(dir)
  })
  assert.equal(durante, true)
  assert.equal(existsSync(dir), false)
})

test('comTrava e soltarVaga soltam a trava mesmo com o info.json aberto por outro processo', async () => {
  const dir = join(tmp(), 'lock')
  let fd = -1
  await comTrava(dir, 1000, () => {
    fd = openSync(join(dir, 'info.json'), 'r')
  })
  closeSync(fd)
  assert.equal(existsSync(dir), false)

  const base = join(tmp(), 'q')
  assert.ok(publicar(join(base, '1'), { pid: process.pid }))
  fd = openSync(join(base, '1', 'info.json'), 'r')
  soltarVaga(base, 1)
  closeSync(fd)
  assert.equal(existsSync(join(base, '1')), false)
})
