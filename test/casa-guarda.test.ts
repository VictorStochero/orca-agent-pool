import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// Toda suíte que exercita CLI, hooks ou worker compara a casa real antes e depois (test/helpers/casa.ts).
test('suítes do CLI, dos hooks e do worker usam guardarCasaReal', () => {
  const dir = import.meta.dirname
  const sem = readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts') && f !== 'casa-guarda.test.ts')
    .filter((f) => /from '\.\.\/src\/(cli|hooks|worker)\//.test(readFileSync(join(dir, f), 'utf8')))
    .filter((f) => !/^\s*guardarCasaReal\(\)/m.test(readFileSync(join(dir, f), 'utf8')))
  assert.deepEqual(sem, [])
})

test('envCasa isola HOME e USERPROFILE', async () => {
  const { envCasa } = await import('./helpers/casa.ts')
  const env = envCasa('/x/casa', { HOMEDRIVE: 'C:', HOMEPATH: '\real', A: '1' })
  assert.deepEqual([env.HOME, env.USERPROFILE, env.HOMEDRIVE, env.HOMEPATH, env.A], ['/x/casa', '/x/casa', undefined, undefined, '1'])
})
