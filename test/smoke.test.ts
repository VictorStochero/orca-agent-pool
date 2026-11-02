import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { versao } from '../src/core/index.ts'

test('versão do núcleo acompanha o package.json e o manifesto', () => {
  const ler = (arquivo: string) => JSON.parse(readFileSync(new URL(`../${arquivo}`, import.meta.url), 'utf8')).version
  assert.equal(versao, ler('package.json'))
  assert.equal(versao, ler('orca-plugin.json'))
})
