import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function gravar(arq: string, conteudo: string, modo?: number): void {
  const tmp = `${arq}.${process.pid}.tmp`
  writeFileSync(tmp, conteudo)
  if (modo) chmodSync(tmp, modo)
  renameSync(tmp, arq)
}

/**
 * Lança o CLI com o runtime do Orca (`ELECTRON_RUN_AS_NODE=1`); sem Orca, com o `node` do PATH.
 * `agent-pool` (sh) sempre; `agent-pool.cmd` no Windows. Regravado a cada ativação: o caminho do Orca muda com a atualização.
 */
export function instalarLancador(bin: string, orcaExe: string | null, cli: string, plataforma: NodeJS.Platform): void {
  if ([orcaExe ?? '', cli].some((c) => /["\r\n]/.test(c))) throw new Error('caminho inválido para o lançador')
  mkdirSync(bin, { recursive: true })
  const barras = (c: string) => c.replace(/\\/g, '/')
  const sh = orcaExe
    ? `ELECTRON_RUN_AS_NODE=1 exec "${barras(orcaExe)}" "${barras(cli)}" "$@"`
    : `exec node "${barras(cli)}" "$@"`
  gravar(join(bin, 'agent-pool'), `#!/bin/sh\n${sh}\n`, 0o755)
  if (plataforma !== 'win32') return
  const cmd = orcaExe
    ? `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${orcaExe}" "${cli}" %*\r\nexit /b %ERRORLEVEL%\r\n`
    : `@echo off\r\nnode "${cli}" %*\r\nexit /b %ERRORLEVEL%\r\n`
  gravar(join(bin, 'agent-pool.cmd'), cmd)
}
