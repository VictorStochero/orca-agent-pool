import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { criarOrcaCli, resolverOrca } from '../src/core/orca.ts'

test('criarOrcaCli completa APPDATA e usa o orca.exe ao lado do execPath', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'ap-orca-'))
  const bin = join(raiz, 'Orca', 'resources', 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'orca.exe'), '')
  const exec = join(raiz, 'Orca', 'Orca.exe')
  const r = resolverOrca({ PATH: 'x' }, 'win32', exec, 'C:\\Usuario\\u')
  assert.equal(r.comando, join(bin, 'orca.exe').replace(/\\/g, '/'))
  assert.equal(r.env.ORCA_CMD, r.comando)
  assert.equal(r.env.APPDATA, join('C:\\Usuario\\u', 'AppData', 'Roaming'))
  assert.equal(r.env.LOCALAPPDATA, join('C:\\Usuario\\u', 'AppData', 'Local'))
  assert.equal(typeof criarOrcaCli({}, 'win32', exec).run, 'function')
  rmSync(raiz, { recursive: true, force: true })
})

test('resolverOrca respeita ORCA_CMD absoluto existente e não sobrescreve APPDATA', () => {
  const r = resolverOrca({ ORCA_CMD: process.execPath, APPDATA: 'A' }, 'win32', 'C:\\nada\\Orca.exe', 'C:\\Usuario\\u')
  assert.equal(r.comando, process.execPath)
  assert.equal(r.env.APPDATA, 'A')
})

test('resolverOrca sem nada achado cai em "orca" e não mexe em APPDATA fora do Windows', () => {
  const r = resolverOrca({}, 'linux', '/opt/nada/orca-app', '/home/u')
  assert.equal(r.comando, 'orca')
  assert.equal(r.env.APPDATA, undefined)
})

test('run devolve código, stdout e stderr sem lançar', async () => {
  const orca = criarOrcaCli({ ...process.env, ORCA_CMD: process.execPath }, 'linux', process.execPath)
  const ok = await orca.run(['-e', 'console.log("oi")'])
  assert.deepEqual([ok.code, ok.stdout.trim()], [0, 'oi'])
  const ruim = await orca.run(['-e', 'console.error("x");process.exit(3)'])
  assert.deepEqual([ruim.code, ruim.stderr.trim()], [3, 'x'])
  const lento = await orca.run(['-e', 'setTimeout(()=>{},5000)'], { timeoutMs: 200 })
  assert.equal(lento.code, 124)
  const ausente = await criarOrcaCli({ ORCA_CMD: 'nao-existe-orca-xyz' }, 'linux', '/x').run([])
  assert.equal(ausente.code, 127)
})
