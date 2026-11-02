import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function tmp(prefixo = 'ap-fila-'): string {
  return mkdtempSync(join(tmpdir(), prefixo))
}

/** Cria arquivos (caminho relativo → conteúdo) dentro de `dir`. */
export function arquivos(dir: string, mapa: Record<string, string>): string {
  for (const [rel, conteudo] of Object.entries(mapa)) {
    const alvo = join(dir, rel)
    mkdirSync(dirname(alvo), { recursive: true })
    writeFileSync(alvo, conteudo)
  }
  return dir
}

/** Pid de um processo que já terminou. */
export function pidMorto(): number {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'])
  return Number(r.stdout.toString())
}
