import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { gravarAtomico } from '../core/atomico.ts'

/** Arquivo real por trás de um link (dotfiles); inexistente fica como veio. */
export const alvoReal = (arquivo: string): string => (existsSync(arquivo) ? realpathSync(arquivo) : arquivo)

/** Grava de forma atômica no alvo real: um link para outro arquivo continua link. */
export function gravar(arquivo: string, texto: string): void {
  const alvo = alvoReal(arquivo)
  mkdirSync(dirname(alvo), { recursive: true })
  // O rename troca o inode: sem repassar o modo, um settings.json 0600 (com chave de API) viraria 0644.
  gravarAtomico(alvo, texto, existsSync(alvo) ? statSync(alvo).mode & 0o777 : undefined)
}
