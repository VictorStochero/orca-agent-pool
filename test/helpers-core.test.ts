import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { gravarAtomico } from '../src/core/atomico.ts'
import { chaveEnv, nomeDoExecutavel, semAtribuicoes } from '../src/core/executavel.ts'
import { pastaDaConta } from '../src/core/medidas/claude.ts'
import { expandirHome } from '../src/core/paths.ts'
import { estadoHooks } from '../src/hooks/comum.ts'
import { tmp } from './fila-util.ts'
import { guardarCasaReal } from './helpers/casa.ts'
import { conta } from './helpers/pool.ts'

guardarCasaReal()

test('expandirHome: só ~, ~/ e ~\\ valem a casa; ~nome fica como veio', () => {
  assert.equal(expandirHome('~', '/h'), '/h')
  assert.equal(expandirHome('~/.claude', '/h'), join('/h', '.claude'))
  assert.equal(expandirHome('~\\.claude', '/h'), join('/h', '.claude'))
  assert.equal(expandirHome('~foo', '/h'), '~foo')
  assert.equal(expandirHome('/abs', '/h'), '/abs')
})

test('~nome em pasta de conta não vira subpasta da casa', () => {
  const casa = tmp()
  assert.equal(pastaDaConta({ ...conta('a'), config: '~foo' }, casa), '~foo')
  const pastas = estadoHooks(casa, '/h/.agents/bin/agent-pool', { claude: ['~foo'] }).map(e => e.pasta)
  assert.ok(!pastas.some(p => p.startsWith(casa) && p.endsWith('foo')), pastas.join(', '))
})

test('chaveEnv acha a variável sem ligar para maiúsculas; ausente devolve o nome pedido', () => {
  assert.equal(chaveEnv({ Path: 'x' }, 'PATH'), 'Path')
  assert.equal(chaveEnv({ path: 'x' }, 'PATH'), 'path')
  assert.equal(chaveEnv({}, 'PATH'), 'PATH')
})

test('nomeDoExecutavel tira pasta, extensão e caixa', () => {
  assert.equal(nomeDoExecutavel('C:\\bin\\Codex.EXE'), 'codex')
  assert.equal(nomeDoExecutavel('/usr/bin/npm.cmd'), 'npm')
  assert.equal(nomeDoExecutavel('php'), 'php')
})

test('semAtribuicoes tira só as atribuições à frente', () => {
  assert.deepEqual(semAtribuicoes(['A=1', 'B=2', 'npm', 'C=3']), ['npm', 'C=3'])
  assert.deepEqual(semAtribuicoes(['npm', 'A=1']), ['npm', 'A=1'])
  assert.deepEqual(semAtribuicoes(['A=1']), [])
})

test('gravarAtomico grava, substitui e não deixa temporário', () => {
  const dir = tmp()
  const arq = join(dir, 'a.json')
  gravarAtomico(arq, '1')
  gravarAtomico(arq, '2')
  assert.equal(readFileSync(arq, 'utf8'), '2')
  assert.deepEqual(readdirSync(dir), ['a.json'])
  assert.throws(() => gravarAtomico(join(dir, 'falta', 'b'), 'x'))
  assert.equal(existsSync(join(dir, 'falta')), false)
})
