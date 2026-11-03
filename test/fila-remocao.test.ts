import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ConfigFila } from '../src/core/tipos.ts'
import { paths } from '../src/core/paths.ts'
import { rodarNaFila } from '../src/core/fila/rodar.ts'
import { limparEsperaMorta, soltarVaga } from '../src/core/fila/travas.ts'
import { pidMorto, tmp } from './fila-util.ts'

/** Segura o arquivo sem compartilhar exclusão (como antivírus/indexador no Windows); só devolve depois de aberto. */
async function travar(arquivo: string) {
  const filho = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$f=[IO.File]::Open('${arquivo}','Open','ReadWrite','None'); 'pronto'; Start-Sleep 120`], { windowsHide: true })
  await new Promise<void>((ok, falha) => {
    filho.once('error', falha)
    filho.once('exit', () => falha(new Error('filho saiu antes de abrir o arquivo')))
    filho.stdout.on('data', (d) => String(d).includes('pronto') && ok())
  })
  return async () => {
    if (filho.exitCode === null) {
      const saiu = new Promise((r) => filho.once('exit', r))
      filho.kill()
      await saiu
    }
  }
}

test('soltarVaga não lança com arquivo preso dentro da vaga (Windows)', { skip: process.platform !== 'win32' }, async () => {
  const base = tmp()
  const vaga = join(base, '1')
  mkdirSync(vaga)
  const arquivo = join(vaga, 'info.json')
  writeFileSync(arquivo, '{}')
  const soltar = await travar(arquivo)
  try {
    assert.throws(() => rmSync(vaga, { recursive: true, force: true }), /EBUSY|EPERM|ENOTEMPTY/)
    assert.doesNotThrow(() => soltarVaga(base, 1))
  } finally {
    await soltar()
  }
  rmSync(vaga, { recursive: true, force: true })
  assert.equal(existsSync(vaga), false)
})

test('registro de espera preso não derruba limparEsperaMorta nem rodarNaFila (Windows)', { skip: process.platform !== 'win32' }, async () => {
  const p = paths(tmp())
  const morta = join(p.espera, String(pidMorto()))
  const minha = join(p.espera, String(process.pid))
  for (const d of [morta, minha]) {
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'info.json'), '{}')
  }
  const soltarMorta = await travar(join(morta, 'info.json'))
  const soltarMinha = await travar(join(minha, 'info.json'))
  try {
    assert.doesNotThrow(() => limparEsperaMorta(p, (pid) => pid === process.pid))
    const cfg: ConfigFila = { modo: 'global', vagas: 1, vagasPorProjeto: 1, teto: 1, processos: 1, esperaMaxS: 2 }
    assert.equal(await rodarNaFila({ dir: tmp(), comando: [process.execPath, '-e', 'process.exit(0)'], config: cfg, p, env: {} }), 0)
  } finally {
    await soltarMorta()
    await soltarMinha()
  }
})
