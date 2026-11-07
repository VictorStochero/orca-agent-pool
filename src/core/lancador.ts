import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { gravarAtomico } from './atomico.ts'

const SEM_PLUGIN =
  'agent-pool: plugin files not found. Open the Agent Pool panel in Orca and install the launcher again; if you removed the plugin, see Uninstall in its README.'

/**
 * Arquivos do lançador e o conteúdo de cada um: lança o CLI com o runtime do Orca (`ELECTRON_RUN_AS_NODE=1`); sem Orca, com o `node` do PATH.
 * `agent-pool` (sh) sempre; `agent-pool.cmd` no Windows. Sem o CLI (plugin removido ou versão antiga apagada) avisa e sai 1:
 * o Claude e o Codex mostram a falha do hook e deixam o comando seguir, sem travar o agente.
 */
export function arquivosLancador(bin: string, orcaExe: string | null, cli: string, plataforma: NodeJS.Platform): Record<string, string> {
  // Aspas e quebra de linha fecham a string; `$`, crase (sh) e `%` (cmd) expandem dentro das aspas duplas.
  if ([orcaExe ?? '', cli].some(c => /["\r\n$`%]/.test(c))) throw new Error('caminho inválido para o lançador')
  const barras = (c: string) => c.replace(/\\/g, '/')
  const sh = orcaExe ? `ELECTRON_RUN_AS_NODE=1 exec "${barras(orcaExe)}" "${barras(cli)}" "$@"` : `exec node "${barras(cli)}" "$@"`
  const r = {
    [join(bin, 'agent-pool')]: `#!/bin/sh\nif [ ! -f "${barras(cli)}" ]; then\n  echo "${SEM_PLUGIN}" >&2\n  exit 1\nfi\n${sh}\n`,
  }
  if (plataforma !== 'win32') return r
  const roda = orcaExe ? `setlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${orcaExe}" "${cli}" %*\r\n` : `node "${cli}" %*\r\n`
  r[join(bin, 'agent-pool.cmd')] =
    `@echo off\r\nif not exist "${cli}" (\r\n  echo ${SEM_PLUGIN} 1>&2\r\n  exit /b 1\r\n)\r\n${roda}exit /b %ERRORLEVEL%\r\n`
  return r
}

export function instalarLancador(bin: string, orcaExe: string | null, cli: string, plataforma: NodeJS.Platform): void {
  const arquivos = arquivosLancador(bin, orcaExe, cli, plataforma)
  mkdirSync(bin, { recursive: true })
  for (const [arq, conteudo] of Object.entries(arquivos)) gravarAtomico(arq, conteudo, arq.endsWith('.cmd') ? undefined : 0o755)
}

/**
 * Argumentos do lançador desta instalação: o Node 24 do Orca roda TypeScript direto (o plugin do catálogo não traz dist/);
 * fora do Orca, o `node` do PATH. O worker (instala) e o doctor (confere) montam o esperado pela mesma regra.
 */
export function argsLancador(bin: string, raizPlugin: string): Parameters<typeof instalarLancador> {
  const orcaExe = basename(process.execPath).toLowerCase().startsWith('node') ? null : process.execPath
  return [bin, orcaExe, join(raizPlugin, 'src', 'cli', 'main.ts'), process.platform]
}

/** Lançador que os hooks chamam: `.cmd` no Windows, o script sh nos demais. */
export const caminhoLancador = (bin: string): string => join(bin, process.platform === 'win32' ? 'agent-pool.cmd' : 'agent-pool')

export const lancadorEsperado = (bin: string, raizPlugin: string): Record<string, string> =>
  arquivosLancador(...argsLancador(bin, raizPlugin))

/** Conteúdo diferente do esperado = aponta para outra pasta do plugin ou do Orca (atualização). */
export function estadoLancador(esperado: Record<string, string>): 'ok' | 'ausente' | 'desatualizado' {
  const arquivos = Object.entries(esperado)
  if (arquivos.some(([f]) => !existsSync(f))) return 'ausente'
  return arquivos.every(([f, conteudo]) => readFileSync(f, 'utf8') === conteudo) ? 'ok' : 'desatualizado'
}
