import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { validar } from '../src/core/config.ts'
import { importarLegado } from '../src/core/legado.ts'

const fixture = join(import.meta.dirname, 'fixtures', 'agentes.conf')

function casa(agentes: string | null, fila?: string) {
  const home = mkdtempSync(join(tmpdir(), 'ap-leg-'))
  mkdirSync(join(home, '.claude'))
  if (agentes !== null) writeFileSync(join(home, '.claude', 'agentes.conf'), agentes)
  if (fila !== undefined) writeFileSync(join(home, '.claude', 'fila.conf'), fila)
  return { home, fim: () => rmSync(home, { recursive: true, force: true }) }
}

test('sem agentes.conf nem fila.conf devolve null', () => {
  const { home, fim } = casa(null)
  assert.equal(importarLegado(home), null)
  fim()
})

test('importarLegado do agentes.conf (fixture) reproduz contas, ordem, comando, ativo=nao e o fila.conf', () => {
  const fila = 'FILA_TESTE_FILA=recurso\nFILA_TESTE_VAGAS=3\nFILA_TESTE_VAGAS_PROJETO=2\nFILA_TESTE_TETO=4\nFILA_TESTE_PROCESSOS=6\n'
  const { home, fim } = casa(readFileSync(fixture, 'utf8'), fila)
  const originais = [readFileSync(join(home, '.claude', 'agentes.conf'), 'utf8'), readFileSync(join(home, '.claude', 'fila.conf'), 'utf8')]
  const c = importarLegado(home)!
  assert.equal(c.versao, 1)
  assert.deepEqual(c.pool.contas.map((x) => x.nome), ['main', 'work', 'extra', 'codex', 'review', 'custom', 'opencode'])
  assert.deepEqual([c.pool.escolha, c.pool.teto, c.pool.ramMinGb], ['ritmo', 0, 3])
  const por = Object.fromEntries(c.pool.contas.map((x) => [x.nome, x]))
  assert.deepEqual([por.main.vagas, por.main.peso, por.main.papeis], [0, 10, ['orquestra']])
  assert.deepEqual([por.extra.config, por.extra.vagas, por.extra.peso], ['~/.claude-extra', 3, 5])
  assert.deepEqual(por.extra.papeis, ['escritor', 'revisor', 'verificador', 'mecanico'])
  assert.equal(por.custom.comando, 'claude-custom')
  assert.deepEqual([por.review.agente, por.review.papeis, por.review.ativo], ['antigravity', ['segunda-opiniao'], true])
  assert.deepEqual([por.opencode.ativo, por.opencode.vagas], [false, 2])
  assert.ok(c.pool.contas.every((x) => x.origem === 'manual'))
  assert.deepEqual(c.fila, { modo: 'banco', vagas: 3, vagasPorProjeto: 2, teto: 4, processos: 6, esperaMaxS: 300 })
  assert.deepEqual(validar(c), [])
  assert.deepEqual([readFileSync(join(home, '.claude', 'agentes.conf'), 'utf8'), readFileSync(join(home, '.claude', 'fila.conf'), 'utf8')], originais)
  fim()
})

test('legado: conta=N antiga, comando entre aspas e linha inválida do fila.conf', () => {
  const { home, fim } = casa('escolha=ordem\nteto=2\nx agente=claude comando="meu claude" vagas=1\nx=5\n', 'FILA_TESTE_VAGAS=abc\nFILA_TESTE_FILA=global\n')
  const c = importarLegado(home)!
  assert.deepEqual([c.pool.escolha, c.pool.teto], ['ordem', 2])
  assert.deepEqual([c.pool.contas[0].comando, c.pool.contas[0].vagas], ['meu claude', 5])
  assert.deepEqual([c.fila.modo, c.fila.vagas], ['global', 2])
  fim()
})

test('legado: conta com agente desconhecido, peso inválido ou papel não permitido é descartada e a config segue válida', () => {
  const { home, fim } = casa('boa agente=claude vagas=2\nx agente=copilot\ny agente=claude peso=0\nz agente=claude vagas=abc\nk agente=kimi papeis=escritor\nboa agente=claude\n')
  const c = importarLegado(home)!
  assert.deepEqual(c.pool.contas.map((x) => x.nome), ['boa'])
  assert.deepEqual(validar(c), [])
  fim()
})
