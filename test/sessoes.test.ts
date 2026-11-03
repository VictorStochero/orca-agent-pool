import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { sessoesAbertas } from '../src/core/sessoes.ts'
import { arquivos, pidMorto, tmp } from './fila-util.ts'

const sessao = (o: Record<string, unknown>) => JSON.stringify(o)

test('conta só sessão interativa com pid vivo', () => {
  const dir = tmp('sessoes-')
  try {
    arquivos(dir, {
      'sessions/1.json': sessao({ pid: process.pid, kind: 'interactive', name: 'viva', cwd: 'C:\\x', status: 'busy' }),
      'sessions/2.json': sessao({ pid: pidMorto(), kind: 'interactive', name: 'morta' }),
      'sessions/3.json': sessao({ pid: process.pid, kind: 'headless', name: 'outra' }),
    })
    assert.deepEqual(sessoesAbertas(dir), ['viva'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('pasta ausente dá lista vazia', () => {
  const dir = tmp('sessoes-')
  try { assert.deepEqual(sessoesAbertas(dir), []) } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('JSON inválido e arquivo sem pid inteiro positivo são ignorados', () => {
  const dir = tmp('sessoes-')
  try {
    arquivos(dir, {
      'sessions/a.json': '{não é json',
      'sessions/b.json': sessao({ kind: 'interactive', name: 'sem-pid' }),
      'sessions/c.json': sessao({ pid: 'abc', kind: 'interactive' }),
      'sessions/d.json': sessao({ pid: 0, kind: 'interactive' }),
      'sessions/e.json': sessao({ pid: -1, kind: 'interactive' }),
    })
    assert.deepEqual(sessoesAbertas(dir, () => true), [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('sem name o nome é o pid', () => {
  const dir = tmp('sessoes-')
  try {
    arquivos(dir, { 'sessions/1.json': sessao({ pid: process.pid, kind: 'interactive' }) })
    assert.deepEqual(sessoesAbertas(dir), [String(process.pid)])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
