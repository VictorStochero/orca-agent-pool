import { existsSync, mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Arquivo real por trás de um link (dotfiles); inexistente fica como veio. */
export const alvoReal = (arquivo: string): string => (existsSync(arquivo) ? realpathSync(arquivo) : arquivo)

/** Grava por temporário + rename no alvo real: um link para outro arquivo continua link. */
export function gravar(arquivo: string, texto: string): void {
  const alvo = alvoReal(arquivo)
  mkdirSync(dirname(alvo), { recursive: true })
  const tmp = `${alvo}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, texto)
    renameSync(tmp, alvo)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* já não existe */ }
    throw e
  }
}
