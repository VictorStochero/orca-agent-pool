import { randomUUID } from 'node:crypto'
import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs'

/** Grava por arquivo temporário + rename: o leitor concorrente nunca vê o arquivo pela metade. */
export function gravarAtomico(arquivo: string, conteudo: string, modo?: number): void {
  const tmp = `${arquivo}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, conteudo, { flag: 'wx', mode: modo })
    if (modo !== undefined) chmodSync(tmp, modo)
    renameSync(tmp, arquivo)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}
