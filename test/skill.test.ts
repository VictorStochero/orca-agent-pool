import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { destinoSkill } from '../src/core/paths.ts'
import { estadoSkill, linksFaltando } from '../src/core/skill.ts'
import { instalarSkill, removerSkill } from '../src/worker/skill.ts'
import { guardarCasaReal } from './helpers/casa.ts'

guardarCasaReal()

let raiz = ''
let home = ''
let origem = ''

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'skill-'))
  home = join(raiz, 'home')
  origem = join(raiz, 'origem')
  mkdirSync(join(origem, 'ref'), { recursive: true })
  writeFileSync(join(origem, 'SKILL.md'), 'v1\n')
  writeFileSync(join(origem, 'ref', 'a.md'), 'a\n')
  mkdirSync(home)
})
afterEach(() => rmSync(raiz, { recursive: true, force: true }))

const v = (versao: string) => ({ versao })

test('instala a cópia e o link do agente; segunda chamada é idempotente', () => {
  const r = instalarSkill(origem, home, ['claude', 'codex', 'antigravity'], v('0.1.0'))
  assert.equal(r.copia, 'instalada')
  assert.equal(readFileSync(join(destinoSkill(home), 'ref', 'a.md'), 'utf8'), 'a\n')
  assert.deepEqual(
    r.links.map(l => [l.agente, l.estado]),
    [
      ['claude', 'criado'],
      ['codex', 'criado'],
      ['antigravity', 'criado'],
    ],
  )
  assert.ok(lstatSync(join(home, '.claude', 'skills', 'agent-pool')).isSymbolicLink())
  assert.ok(lstatSync(join(home, '.gemini', 'config', 'skills', 'agent-pool')).isSymbolicLink())
  assert.equal(readFileSync(join(home, '.claude', 'skills', 'agent-pool', 'SKILL.md'), 'utf8'), 'v1\n')
  const r2 = instalarSkill(origem, home, ['claude'], v('0.1.0'))
  assert.equal(r2.copia, 'ja')
  assert.equal(r2.links[0].estado, 'ja')
  assert.equal(estadoSkill(origem, home, '0.1.0'), 'ok')
})

test('origem nova ou versão nova atualiza a cópia não editada', () => {
  instalarSkill(origem, home, [], v('0.1.0'))
  writeFileSync(join(origem, 'SKILL.md'), 'v2\n')
  assert.equal(estadoSkill(origem, home, '0.1.0'), 'desatualizada')
  assert.equal(instalarSkill(origem, home, [], v('0.1.0')).copia, 'atualizada')
  assert.equal(readFileSync(join(destinoSkill(home), 'SKILL.md'), 'utf8'), 'v2\n')
  assert.equal(instalarSkill(origem, home, [], v('0.2.0')).copia, 'atualizada')
})

test('skill editada não é sobrescrita; apagar a pasta e instalar de novo troca', () => {
  instalarSkill(origem, home, [], v('0.1.0'))
  writeFileSync(join(destinoSkill(home), 'SKILL.md'), 'meu texto\n')
  writeFileSync(join(origem, 'SKILL.md'), 'v2\n')
  const r = instalarSkill(origem, home, [], v('0.1.0'))
  assert.equal(r.copia, 'editada')
  assert.match(r.avisos[0], /editada/)
  assert.equal(readFileSync(join(destinoSkill(home), 'SKILL.md'), 'utf8'), 'meu texto\n')
  rmSync(destinoSkill(home), { recursive: true })
  assert.equal(instalarSkill(origem, home, [], v('0.1.0')).copia, 'instalada')
  assert.equal(readFileSync(join(destinoSkill(home), 'SKILL.md'), 'utf8'), 'v2\n')
})

test('link existente que não é o nosso é pulado com aviso, sem apagar', () => {
  mkdirSync(join(home, '.claude', 'skills', 'agent-pool'), { recursive: true })
  writeFileSync(join(home, '.claude', 'skills', 'agent-pool', 'x'), 'meu')
  const r = instalarSkill(origem, home, ['claude'], v('0.1.0'))
  assert.equal(r.links[0].estado, 'pulado')
  assert.equal(r.avisos.length, 1)
  assert.deepEqual(readdirSync(join(home, '.claude', 'skills', 'agent-pool')), ['x'])
})

test('origem ausente: sem_origem e nada criado', () => {
  const r = instalarSkill(join(raiz, 'nao-existe'), home, ['claude'], v('0.1.0'))
  assert.equal(r.copia, 'sem_origem')
  assert.equal(existsSync(destinoSkill(home)), false)
})

test('links faltando apontam o que a instalação criaria; remover a skill tira só os nossos links e a cópia', () => {
  const pastas = { claude: ['~/.claude-work'] }
  mkdirSync(join(home, '.claude-work'))
  assert.deepEqual(linksFaltando(home, ['claude'], pastas), [
    join(home, '.claude', 'skills', 'agent-pool'),
    join(home, '.claude-work', 'skills', 'agent-pool'),
  ])
  instalarSkill(origem, home, ['claude'], { versao: '0.1.0', pastas })
  assert.deepEqual(linksFaltando(home, ['claude'], pastas), [])
  // algo do usuário no lugar do link não é "faltando" nem é apagado
  mkdirSync(join(home, '.codex', 'skills', 'agent-pool'), { recursive: true })
  assert.deepEqual(linksFaltando(home, ['codex'], {}), [])
  removerSkill(home, pastas)
  assert.equal(existsSync(join(home, '.claude', 'skills', 'agent-pool')), false)
  assert.equal(existsSync(join(home, '.claude-work', 'skills', 'agent-pool')), false)
  assert.equal(existsSync(destinoSkill(home)), false)
  assert.equal(existsSync(join(home, '.codex', 'skills', 'agent-pool')), true)
})
