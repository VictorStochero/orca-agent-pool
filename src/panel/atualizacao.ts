// Vigília do painel: enquanto a tela está aberta, o worker coleta no intervalo configurado e avisa por 'estado.mudou'.
import { plugin } from 'orca'

const RETENTA_MS = 5_000

/** Chamar uma vez no `setup` da tela: `void manterAtualizando(ctx.signal)`. Para quando o painel fecha. */
export async function manterAtualizando(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      await plugin.request('auto.assistir', undefined, { signal, timeoutMs: 120_000 })
    } catch {
      if (signal.aborted) return
      await new Promise(r => setTimeout(r, RETENTA_MS))
    }
  }
}
