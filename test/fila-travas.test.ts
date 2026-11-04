import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { paths } from '../src/core/paths.ts'
import * as travas from '../src/core/fila/travas.ts'
import { tmp } from './fila-util.ts'

test('varredura recupera todas as filas e o teto, preservando dono ou órfão vivo', () => {
  const p = paths(tmp())
  const casos = [
    { fila: 'banco-a', pid: 11, filho: undefined, fica: false },
    { fila: 'banco-b', pid: 12, filho: undefined, fica: true },
    { fila: 'projeto-c', pid: 13, filho: { pid: 14, inicio: 1 }, fica: true },
    { fila: 'projeto-d', pid: 15, filho: { pid: 16, inicio: 1 }, fica: false },
    { fila: '_teto', pid: 11, filho: undefined, fica: false }
  ]
  for (const c of casos) assert.ok(travas.publicar(join(p.fila, c.fila, '1'), { pid: c.pid, filho: c.filho }))
  const ilegivel = join(p.fila, 'global', '2')
  mkdirSync(ilegivel, { recursive: true })
  writeFileSync(join(ilegivel, 'info.json'), '{')
  travas.limparTravasMortas(p, (pid) => pid === 12, (filho) => filho.pid === 14)
  for (const c of casos) assert.equal(existsSync(join(p.fila, c.fila, '1')), c.fica, c.fila)
  assert.equal(existsSync(ilegivel), false)
})

test('a varredura de travas também apaga a espera de pid morto e preserva a de pid vivo', () => {
  const p = paths(tmp())
  for (const pid of [21, 22]) mkdirSync(join(p.espera, String(pid)), { recursive: true })
  travas.limparTravasMortas(p, (pid) => pid === 22)
  assert.equal(existsSync(join(p.espera, '21')), false)
  assert.equal(existsSync(join(p.espera, '22')), true)
})
