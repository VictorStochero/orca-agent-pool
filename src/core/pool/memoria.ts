import type { OrcaCli } from '../tipos.ts'

/** GB livres segundo o Orca; null quando a leitura é inconclusiva (o portão então não bloqueia). */
export async function ramLivreGb(orca: OrcaCli): Promise<number | null> {
  try {
    const r = await orca.run(['diagnostics', 'memory', '--json'], { timeoutMs: 15_000 })
    if (r.code !== 0) return null
    const d = JSON.parse(r.stdout)
    const bytes = d?.result?.host?.availableMemory
    if (d?.ok === false || typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null
    return bytes / 1073741824
  } catch {
    return null
  }
}
