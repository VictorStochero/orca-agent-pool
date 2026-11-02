import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import type { OrcaCli, ResultadoOrca } from './tipos.ts'

export type { OrcaCli }

const TIMEOUT_PADRAO_MS = 30_000

/**
 * Caminho do CLI do Orca: o PATH do worker não traz a pasta do CLI. Respeita ORCA_CMD absoluto que exista
 * (devolve undefined: nada a completar); senão procura ao lado do executável do Orca e na instalação padrão.
 */
function acharOrca(env: NodeJS.ProcessEnv, plataforma: string, execPath: string, casa: string, existe: (c: string) => boolean): string | undefined {
  const dado = env.ORCA_CMD || env.ORCA_CLI_COMMAND
  if (dado && isAbsolute(dado) && existe(dado)) return undefined
  const candidatos: string[] = []
  if (plataforma === 'win32') {
    const local = env.LOCALAPPDATA ?? join(casa, 'AppData', 'Local')
    candidatos.push(join(dirname(execPath), 'resources', 'bin', 'orca.exe'), join(local, 'Programs', 'orca', 'resources', 'bin', 'orca.exe'))
  } else if (plataforma === 'darwin') {
    candidatos.push(join(dirname(execPath), '..', 'Resources', 'bin', 'orca'), '/Applications/Orca.app/Contents/Resources/bin/orca')
  } else {
    candidatos.push(join(dirname(execPath), 'resources', 'bin', 'orca'), join(dirname(execPath), 'bin', 'orca'))
  }
  return candidatos.find(existe)?.replace(/\\/g, '/')
}

/** Comando e ambiente do processo filho: APPDATA/LOCALAPPDATA (o worker chega sem eles), ORCA_CMD e PATH extra. */
export function resolverOrca(
  env: NodeJS.ProcessEnv,
  plataforma: string,
  execPath: string,
  casa: string = homedir(),
  caminhoExtra = '',
  existe: (c: string) => boolean = existsSync
): { comando: string; env: NodeJS.ProcessEnv } {
  const novo: NodeJS.ProcessEnv = { ...env }
  if (caminhoExtra) {
    const chave = Object.keys(novo).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
    const sep = plataforma === 'win32' ? ';' : ':'
    const atual = (novo[chave] ?? '').split(sep).filter(Boolean)
    const vistos = new Set(atual.map((x) => x.toLowerCase()))
    novo[chave] = [...atual, ...caminhoExtra.split(sep).filter((x) => x && !vistos.has(x.toLowerCase()))].join(sep)
  }
  if (plataforma === 'win32') {
    novo.APPDATA ??= join(casa, 'AppData', 'Roaming')
    novo.LOCALAPPDATA ??= join(casa, 'AppData', 'Local')
  }
  const achado = acharOrca(novo, plataforma, execPath, casa, existe)
  if (achado) novo.ORCA_CMD = achado
  return { comando: novo.ORCA_CMD || novo.ORCA_CLI_COMMAND || 'orca', env: novo }
}

let caminhoDoSistema: Promise<string> | undefined

/** PATH de Machine e User lido do sistema (Windows): o do processo do Orca não traz, por exemplo, a pasta do npm global. */
export function lerCaminhoDoSistema(): Promise<string> {
  caminhoDoSistema ??= new Promise((resolve) =>
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"],
      { timeout: 10_000, windowsHide: true, encoding: 'utf8' },
      (erro, saida) => resolve(erro ? '' : saida.trim())
    )
  )
  return caminhoDoSistema
}

export function criarOrcaCli(env: NodeJS.ProcessEnv = process.env, plataforma: string = process.platform, execPath: string = process.execPath): OrcaCli {
  return {
    async run(args, opts) {
      const { comando, env: ambiente } = resolverOrca(env, plataforma, execPath, homedir(), plataforma === 'win32' ? await lerCaminhoDoSistema() : '')
      return new Promise<ResultadoOrca>((resolve) =>
        execFile(
          comando,
          args,
          { timeout: opts?.timeoutMs ?? TIMEOUT_PADRAO_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: 'utf8', env: ambiente },
          (erro, stdout, stderr) => {
            if (!erro) return resolve({ code: 0, stdout, stderr })
            const e = erro as NodeJS.ErrnoException & { killed?: boolean }
            if (e.killed) return resolve({ code: 124, stdout, stderr: stderr || `orca passou de ${(opts?.timeoutMs ?? TIMEOUT_PADRAO_MS) / 1000} s` })
            if (typeof e.code === 'number') return resolve({ code: e.code, stdout, stderr })
            resolve({ code: 127, stdout, stderr: stderr || e.message })
          }
        )
      )
    }
  }
}
