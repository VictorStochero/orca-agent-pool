import assert from 'node:assert/strict'
import { test } from 'node:test'
import { versao } from '../src/core/index.ts'

test('versão do núcleo', () => {
  assert.equal(versao, '1.0.0')
})
