import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acompanharSaida } from '../src/core/fila/saida.ts'

const alimentar = (...partes: (string | Buffer)[]) => {
  const a = acompanharSaida(() => 1000)
  for (const p of partes) a.receber('out', Buffer.from(p))
  return a.estado()
}

test('sem saída não há estado', () => {
  assert.equal(acompanharSaida(() => 1).estado(), null)
})

test('PHPUnit/paratest: feitos, total e pct do fim da linha', () => {
  const s = alimentar(
    '..........                                                        10 / 120 (  8%)\n',
    '...                 63 / 120 ( 52%)\n',
  )
  assert.deepEqual(s, { ts: 1000, linha: '...                 63 / 120 ( 52%)', linhas: 2, pct: 52, feitos: 63, total: 120 })
})

test('pytest: só o pct', () => {
  const s = alimentar('tests/test_a.py ....                                   [ 45%]\n')
  assert.equal(s?.pct, 45)
  assert.equal(s?.feitos, null)
  assert.equal(s?.total, null)
})

test('Pest/Collision e vitest: cada marca no começo da linha soma 1 em feitos', () => {
  const s = alimentar('  ✓ it works\n  ⨯ it fails\n  × outro\n  ✔ ok\n  ✗ ruim\n  ✕ ruim2\n  texto ✓ no meio\n')
  assert.equal(s?.feitos, 6)
  assert.equal(s?.total, null)
  assert.equal(s?.pct, null)
  assert.equal(s?.linhas, 7)
})

test('marcas deixam de contar depois que um total foi visto', () => {
  const s = alimentar('  5 / 10 ( 50%)\n  ✓ it works\n')
  assert.deepEqual([s?.feitos, s?.total, s?.pct], [5, 10, 50])
})

test('remove ANSI da última linha e apara', () => {
  assert.equal(alimentar('\u001b[32m  ✓ it works\u001b[0m  \n')?.linha, '✓ it works')
})

test('chunk que parte um ✓ ao meio não corrompe', () => {
  const b = Buffer.from('  ✓ it works\n')
  const corte = b.indexOf(0xe2) + 1
  const s = alimentar(b.subarray(0, corte), b.subarray(corte))
  assert.deepEqual([s?.feitos, s?.linhas, s?.linha], [1, 1, '✓ it works'])
})

test('\\r sozinho quebra linha e a linha incompleta espera o próximo chunk', () => {
  const s = alimentar('a\rb\rparc', 'ial\n')
  assert.deepEqual([s?.linhas, s?.linha], [3, 'parcial'])
})

test('\\r\\n conta uma linha só', () => {
  assert.equal(alimentar('a\r\nb\r\n')?.linhas, 2)
})

test('corta a linha em 200 caracteres', () => {
  assert.equal(alimentar(`${'x'.repeat(500)}\n`)?.linha?.length, 200)
})

test('ts acompanha qualquer chunk, inclusive stderr e sem linha completa', () => {
  let t = 10
  const a = acompanharSaida(() => t)
  a.receber('out', Buffer.from('a\n'))
  t = 20
  a.receber('err', Buffer.from('sem quebra'))
  const s = a.estado()
  assert.deepEqual([s?.ts, s?.linhas, s?.linha], [20, 1, 'a'])
})
