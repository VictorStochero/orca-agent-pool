import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectarRecurso, chaveFila } from '../src/core/fila/recurso.ts'
import type { Executor } from '../src/core/fila/executores.ts'
import { arquivos, tmp } from './fila-util.ts'

const php: Executor = { nome: 'laravel', comando: ['php', 'artisan', 'test'], paralelo: () => [] }
const ddev: Executor = { nome: 'laravel', comando: ['ddev', 'artisan', 'test'], paralelo: () => [] }
const rec = (mapa: Record<string, string>, env: NodeJS.ProcessEnv = {}, ex: Executor | null = php) =>
  detectarRecurso(arquivos(tmp(), mapa), env, ex)

test('.orca/agent-pool.json vence tudo', () => {
  const mapa = { '.orca/agent-pool.json': '{"recurso":"postgres:5433"}', '.env': 'DATABASE_URL=mysql://u@h:1/d' }
  assert.equal(rec(mapa), 'postgres:5433')
})

test('.orca/agent-pool.json inválido é ignorado', () => {
  assert.equal(rec({ '.orca/agent-pool.json': '{ruim', '.env.testing': 'DB_HOST=db\nDB_PORT=3307' }), 'mysql db:3307')
})

test('DATABASE_URL (ambiente e .env) antes de DB_HOST/DB_PORT', () => {
  assert.equal(rec({ '.env': 'DATABASE_URL=postgresql://u:p@db.local:5433/x\nDB_PORT=1' }), 'postgres db.local:5433/x')
  assert.equal(rec({}, { DATABASE_URL: 'mysql+pymysql://u@localhost/x' }), 'mysql 127.0.0.1:3306/x')
  assert.equal(rec({ '.env': 'DATABASE_URL=postgres://u@h:1/x' }, { DATABASE_URL: 'postgres://u@e:2/x' }), 'postgres e:2/x')
})

test('DB_HOST/DB_PORT: .env.testing antes de .env; aspas e CRLF', () => {
  const mapa = { '.env.testing': 'DB_CONNECTION="pgsql"\r\nDB_PORT=5433\r\n', '.env': 'DB_PORT=1' }
  assert.equal(rec(mapa), 'postgres 127.0.0.1:5433')
  assert.equal(rec({ '.env': 'DB_HOST=10.0.0.5' }), 'mysql 10.0.0.5:3306')
})

test('sqlite não é recurso compartilhado', () => {
  assert.equal(rec({ '.env.testing': 'DB_CONNECTION=sqlite' }), 'geral')
  assert.equal(rec({}, { DATABASE_URL: 'sqlite:///x.db' }), 'geral')
})

test('container e geral', () => {
  assert.equal(rec({}, {}, ddev), 'container ddev')
  assert.equal(rec({ '.env': 'DB_PORT=3307' }, {}, ddev), 'mysql 127.0.0.1:3307')
  assert.equal(rec({}, {}, null), 'geral')
  assert.equal(rec({}), 'geral')
})

test('chaveFila: global serializa tudo, banco separa por recurso, projeto por projeto', () => {
  assert.equal(chaveFila('global', 'mysql 127.0.0.1:3306', 'a'), chaveFila('global', 'postgres h:1', 'b'))
  assert.notEqual(chaveFila('banco', 'mysql 127.0.0.1:3306', 'a'), chaveFila('banco', 'postgres h:1', 'a'))
  assert.equal(chaveFila('banco', 'geral', 'a'), chaveFila('banco', 'geral', 'b'))
  assert.notEqual(chaveFila('projeto', 'geral', 'a'), chaveFila('projeto', 'geral', 'b'))
  assert.equal(chaveFila('projeto', 'x', 'a'), chaveFila('projeto', 'y', 'a'))
  assert.match(chaveFila('banco', 'mysql 127.0.0.1:3306', 'a'), /^[a-z0-9_-]+$/)
})

test('mesmo DB_DATABASE cai na mesma fila; bancos diferentes não', () => {
  const env = (db: string) => `DB_PORT=3306
DB_DATABASE=${db}`
  const chave = (mapa: Record<string, string>) => chaveFila('banco', rec(mapa), 'p')
  assert.equal(rec({ '.env': env('app_testing') }), 'mysql 127.0.0.1:3306/app_testing')
  assert.equal(chave({ '.env': env('app_testing') }), chave({ '.env.testing': env('app_testing') }))
  assert.notEqual(chave({ '.env': env('app_testing') }), chave({ '.env': env('outro') }))
  assert.equal(rec({ '.env': 'DATABASE_URL=postgres://u@h/app_testing' }), 'postgres h:5432/app_testing')
})
