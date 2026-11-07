import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { atualizarConfig, carregar, gravar, PADRAO } from '../src/core/config.ts'
import { aplicar } from '../src/core/config-chaves.ts'
import { importarLegado } from '../src/core/legado.ts'
import { paths } from '../src/core/paths.ts'
import { envCasa } from './helpers/casa.ts'

const filho = (home: string, chave: string, valor: string) =>
  new Promise<number | null>(ok =>
    spawn(process.execPath, ['--experimental-strip-types', join(import.meta.dirname, 'config-filho.ts'), home, chave, valor], {
      stdio: 'ignore',
      env: envCasa(home),
    }).on('close', ok),
  )

test('duas gravações concorrentes de processos diferentes não perdem dado', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cfg-trava-'))
  try {
    const p = paths(home)
    gravar(aplicar(PADRAO, { 'conta.a.adicionar': 'claude', 'conta.b.adicionar': 'claude' }), p)
    const codigos = await Promise.all([filho(home, 'conta.a.vagas', '3'), filho(home, 'conta.b.peso', '5')])
    assert.deepEqual(codigos, [0, 0])
    const c = carregar(p)
    assert.equal(c.pool.contas.find(x => x.nome === 'a')!.vagas, 3)
    assert.equal(c.pool.contas.find(x => x.nome === 'b')!.peso, 5)
    assert.equal(existsSync(`${p.config}.lock`), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('trava de dono morto é retirada e a gravação segue', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cfg-trava-'))
  try {
    const p = paths(home)
    mkdirSync(`${p.config}.lock`, { recursive: true })
    writeFileSync(join(`${p.config}.lock`, 'info.json'), JSON.stringify({ pid: 2147483646 }))
    await atualizarConfig(p, c => aplicar(c, { 'fila.vagas': '5' }))
    assert.equal(carregar(p).fila.vagas, 5)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('sem config.json, a primeira gravação parte do legado e não o apaga nem o esconde', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cfg-trava-'))
  try {
    mkdirSync(join(home, '.claude'), { recursive: true })
    const legado = join(home, '.claude', 'agentes.conf')
    writeFileSync(legado, 'time agente=claude vagas=2\n')
    const p = paths(home)
    await atualizarConfig(
      p,
      c => aplicar(c, { 'pool.ram_min': '2' }),
      () => importarLegado(home),
    )
    const c = carregar(p)
    assert.deepEqual(
      c.pool.contas.map(x => x.nome),
      ['time'],
    )
    assert.equal(c.pool.ramMinGb, 2)
    assert.equal(readFileSync(legado, 'utf8'), 'time agente=claude vagas=2\n')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('legado com conta inválida não impede a primeira gravação', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cfg-trava-'))
  try {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', 'agentes.conf'), 'time agente=claude\nruim agente=kimi papeis=escritor\n')
    const p = paths(home)
    await atualizarConfig(
      p,
      c => aplicar(c, { 'pool.ram_min': '2' }),
      () => importarLegado(home),
    )
    assert.deepEqual(
      carregar(p).pool.contas.map(x => x.nome),
      ['time'],
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
