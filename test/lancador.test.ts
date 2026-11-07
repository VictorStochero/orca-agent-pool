import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { arquivosLancador, instalarLancador } from '../src/core/lancador.ts'

const raizes: string[] = []
const novo = () => {
  const d = mkdtempSync(join(tmpdir(), 'lancador-'))
  raizes.push(d)
  return join(d, 'bin')
}
after(() => {
  for (const d of raizes) rmSync(d, { recursive: true, force: true })
})

describe('instalarLancador', () => {
  it('sh executa o CLI com o runtime do Orca', () => {
    const bin = novo()
    instalarLancador(bin, 'C:\\Usuario\\x\\AppData\\Local\\Programs\\orca\\Orca.exe', 'C:\\p\\src\\cli\\main.ts', 'linux')
    const sh = readFileSync(join(bin, 'agent-pool'), 'utf8')
    assert.match(sh, /^#!\/bin\/sh\n/)
    assert.match(
      sh,
      /ELECTRON_RUN_AS_NODE=1 exec "C:\/Usuario\/x\/AppData\/Local\/Programs\/orca\/Orca\.exe" "C:\/p\/src\/cli\/main\.ts" "\$@"/,
    )
    assert.equal(existsSync(join(bin, 'agent-pool.cmd')), false)
    if (process.platform !== 'win32') assert.ok(statSync(join(bin, 'agent-pool')).mode & 0o100)
  })
  it('cmd no Windows, com o mesmo caminho do Orca', () => {
    const bin = novo()
    instalarLancador(bin, 'C:\\Orca\\Orca.exe', 'C:\\p\\src\\cli\\main.ts', 'win32')
    const cmd = readFileSync(join(bin, 'agent-pool.cmd'), 'utf8')
    assert.match(
      cmd,
      /^@echo off\r\nif not exist "C:\\p\\src\\cli\\main\.ts" \(\r\n {2}echo agent-pool: [^\r\n()]+ 1>&2\r\n {2}exit \/b 1\r\n\)\r\n/,
    )
    assert.ok(
      cmd.endsWith(
        'setlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\Orca\\Orca.exe" "C:\\p\\src\\cli\\main.ts" %*\r\nexit /b %ERRORLEVEL%\r\n',
      ),
    )
    assert.match(readFileSync(join(bin, 'agent-pool'), 'utf8'), /"C:\/Orca\/Orca\.exe"/)
  })
  it('sem Orca achado cai no node do PATH', () => {
    const bin = novo()
    instalarLancador(bin, null, '/p/src/cli/main.ts', 'win32')
    assert.match(readFileSync(join(bin, 'agent-pool'), 'utf8'), /exec node "\/p\/src\/cli\/main\.ts" "\$@"/)
    assert.ok(readFileSync(join(bin, 'agent-pool.cmd'), 'utf8').endsWith('node "/p/src/cli/main.ts" %*\r\nexit /b %ERRORLEVEL%\r\n'))
  })
  it('sem os arquivos do plugin avisa e sai 1 (o hook não fica mudo nem trava o agente)', () => {
    const bin = novo()
    const win = process.platform === 'win32'
    instalarLancador(bin, null, join(bin, 'sumiu', 'main.ts'), process.platform)
    const r = win
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', join(bin, 'agent-pool.cmd'), 'hook', 'claude'], { encoding: 'utf8' })
      : spawnSync('sh', [join(bin, 'agent-pool'), 'hook', 'claude'], { encoding: 'utf8' })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /plugin files not found/)
  })
  it('regravar troca o conteúdo e recusa caminho com aspas', () => {
    const bin = novo()
    instalarLancador(bin, '/a/Orca', '/p/cli.mjs', 'linux')
    instalarLancador(bin, '/b/Orca', '/p/cli.mjs', 'linux')
    assert.match(readFileSync(join(bin, 'agent-pool'), 'utf8'), /"\/b\/Orca"/)
    assert.throws(() => instalarLancador(bin, '/a"b', '/p/cli.mjs', 'linux'))
  })
})

describe('arquivosLancador', () => {
  it('recusa caminho com $, crase ou % (expandem dentro das aspas)', () => {
    for (const ruim of ['C:/Users/R$tec/Orca.exe', 'C:/a`b/Orca.exe', 'C:/%TEMP%/Orca.exe']) {
      assert.throws(() => arquivosLancador('bin', ruim, 'C:/p/main.ts', 'linux'), /caminho inválido/)
    }
  })
})
