import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// O lançador não está no PATH dos agentes: a skill e o README mandam o caminho do lançador.
test('SKILL.md chama o lançador pelo caminho, nunca pelo nome solto', () => {
  const md = readFileSync(join(import.meta.dirname, '..', 'skill', 'agent-pool', 'SKILL.md'), 'utf8')
  const soltos = md.match(/(?<!bin\/)\bagent-pool (test|writer|second|slot|status|doctor|config|measure)\b/g)
  assert.equal(soltos, null, `comando sem caminho: ${soltos}`)
  assert.match(md, /~\/\.agents\/bin\/agent-pool test/)
})
