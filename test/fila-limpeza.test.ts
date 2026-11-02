import assert from 'node:assert/strict'
import { test } from 'node:test'
import { limparBancosLaravel, lerConexao, sqlLimpeza } from '../src/core/fila/limpeza.ts'
import { arquivos, tmp } from './fila-util.ts'

test('sqlLimpeza apaga <banco>_test_1..N e recusa nome suspeito', () => {
  assert.equal(sqlLimpeza('app', 2), 'DROP DATABASE IF EXISTS `app_test_1`; DROP DATABASE IF EXISTS `app_test_2`;')
  assert.equal(sqlLimpeza('app`; drop database x; --', 2), null)
  assert.equal(sqlLimpeza('', 2), null)
})

test('lerConexao: ambiente vence .env.testing, que vence .env', () => {
  const dir = arquivos(tmp(), {
    '.env.testing': 'DB_CONNECTION=mysql\nDB_HOST=db\nDB_USERNAME=u',
    '.env': 'DB_DATABASE=app\nDB_PORT=3307\nDB_PASSWORD="s"'
  })
  assert.deepEqual(lerConexao(dir, { DB_DATABASE: 'outro' }), {
    conexao: 'mysql', host: 'db', porta: '3307', usuario: 'u', senha: 's', base: 'outro'
  })
})

test('sem cliente mysql no PATH, ou conexão sqlite, não faz nada nem falha', async () => {
  const vazio = tmp()
  const dir = arquivos(tmp(), { '.env.testing': 'DB_CONNECTION=mysql\nDB_DATABASE=app' })
  await limparBancosLaravel(dir, { PATH: vazio, HOME: vazio, USERPROFILE: vazio }, 4)
  await limparBancosLaravel(arquivos(tmp(), { '.env': 'DB_CONNECTION=sqlite' }), process.env, 4)
})
