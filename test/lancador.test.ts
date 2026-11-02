import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { instalarLancador } from '../src/core/lancador.ts'

const raizes: string[] = []
const novo = () => {
  const d = mkdtempSync(join(tmpdir(), 'lancador-'))
  raizes.push(d)
  return join(d, 'bin')
}
after(() => raizes.forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('instalarLancador', () => {
  it('sh executa o CLI com o runtime do Orca', () => {
    const bin = novo()
    instalarLancador(bin, 'C:\\Usuario\\x\\AppData\\Local\\Programs\\orca\\Orca.exe', 'C:\\p\\src\\cli\\main.ts', 'linux')
    const sh = readFileSync(join(bin, 'agent-pool'), 'utf8')
    assert.match(sh, /^#!\/bin\/sh\n/)
    assert.match(sh, /ELECTRON_RUN_AS_NODE=1 exec "C:\/Usuario\/x\/AppData\/Local\/Programs\/orca\/Orca\.exe" "C:\/p\/src\/cli\/main\.ts" "\$@"/)
    assert.equal(existsSync(join(bin, 'agent-pool.cmd')), false)
    if (process.platform !== 'win32') assert.ok(statSync(join(bin, 'agent-pool')).mode & 0o100)
  })
  it('cmd no Windows, com o mesmo caminho do Orca', () => {
    const bin = novo()
    instalarLancador(bin, 'C:\\Orca\\Orca.exe', 'C:\\p\\src\\cli\\main.ts', 'win32')
    const cmd = readFileSync(join(bin, 'agent-pool.cmd'), 'utf8')
    assert.equal(cmd, '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\Orca\\Orca.exe" "C:\\p\\src\\cli\\main.ts" %*\r\nexit /b %ERRORLEVEL%\r\n')
    assert.match(readFileSync(join(bin, 'agent-pool'), 'utf8'), /"C:\/Orca\/Orca\.exe"/)
  })
  it('sem Orca achado cai no node do PATH', () => {
    const bin = novo()
    instalarLancador(bin, null, '/p/src/cli/main.ts', 'win32')
    assert.match(readFileSync(join(bin, 'agent-pool'), 'utf8'), /exec node "\/p\/src\/cli\/main\.ts" "\$@"/)
    assert.equal(readFileSync(join(bin, 'agent-pool.cmd'), 'utf8'), '@echo off\r\nnode "/p/src/cli/main.ts" %*\r\nexit /b %ERRORLEVEL%\r\n')
  })
  it('regravar troca o conteúdo e recusa caminho com aspas', () => {
    const bin = novo()
    instalarLancador(bin, '/a/Orca', '/p/cli.mjs', 'linux')
    instalarLancador(bin, '/b/Orca', '/p/cli.mjs', 'linux')
    assert.match(readFileSync(join(bin, 'agent-pool'), 'utf8'), /"\/b\/Orca"/)
    assert.throws(() => instalarLancador(bin, '/a"b', '/p/cli.mjs', 'linux'))
  })
})
