import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { lancar, separarAtribuicoes } from '../src/core/executavel.ts'
import { arquivos, tmp } from './fila-util.ts'

describe('separarAtribuicoes', () => {
  it('corta cada atribuição no primeiro =', () => {
    assert.deepEqual(separarAtribuicoes(['A=1', 'B=x=y', 'cmd', 'C=2']), {
      vars: [
        ['A', '1'],
        ['B', 'x=y'],
      ],
      resto: ['cmd', 'C=2'],
    })
  })
  it('só atribuições: resto vazio', () => {
    assert.deepEqual(separarAtribuicoes(['A=1']), { vars: [['A', '1']], resto: [] })
  })
})

describe('lancar (Windows)', { skip: process.platform !== 'win32' }, () => {
  const esperar = (filho: ReturnType<typeof lancar>) => new Promise<number | null>(resolve => filho.on('close', resolve))

  it('caminho relativo acha o .cmd ao lado do script sem extensão', async () => {
    const dir = arquivos(tmp(), { 'vendor/bin/x': '#!/usr/bin/env php\n', 'vendor/bin/x.cmd': '@echo off\r\nexit /b 0\r\n' })
    assert.equal(await esperar(lancar(['vendor/bin/x'], dir, process.env, 'ignore')), 0)
  })

  it('o .cmd recebe argumento com espaço inteiro', async () => {
    const dir = arquivos(tmp(), { 'x.cmd': '@echo off\r\necho %~1> "%~dp0saida.txt"\r\n' })
    assert.equal(await esperar(lancar([join(dir, 'x.cmd'), 'a b'], dir, process.env, 'ignore')), 0)
    assert.equal(readFileSync(join(dir, 'saida.txt'), 'utf8').trim(), 'a b')
  })
})
