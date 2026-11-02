// Vigília do painel: enquanto a tela está aberta, o worker atualiza a cada período e avisa por 'estado.mudou'.
const CICLO_MS = 60_000
const INTERVALO_MIN_S = 15
const INTERVALO_MAX_S = 3600
// O painel renova a vigília antes do teto de 120 s do plugin.request; a graça cobre o intervalo entre uma e outra.
const RENOVA_MS = 100_000
const GRACA_MS = 3_000

/** Segundos guardados -> ms: ausente ou não numérico usa 60 s; número fora da faixa cai no limite. */
export function intervaloMs(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return CICLO_MS
  return Math.min(INTERVALO_MAX_S, Math.max(INTERVALO_MIN_S, Math.round(valor))) * 1000
}

type OpcoesCiclo = { coletar: () => Promise<unknown>; avisar: () => void; erro: (mensagem: string) => void; periodoMs?: number; gracaMs?: number; renovaMs?: number }

/** Coleta a cada `periodoMs` só enquanto há painel vigiando; se a coleta anterior não terminou, pula o ciclo. */
export function criarCiclo(o: OpcoesCiclo) {
  let periodoMs = o.periodoMs ?? CICLO_MS
  const { gracaMs = GRACA_MS, renovaMs = RENOVA_MS } = o
  let vigias = 0
  let relogio: ReturnType<typeof setInterval> | undefined
  let graca: ReturnType<typeof setTimeout> | undefined
  let rodando = false

  const ciclo = async () => {
    if (rodando) return
    rodando = true
    try {
      await o.coletar()
      o.avisar()
    } catch (e) {
      o.erro(`ciclo de atualização: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      rodando = false
    }
  }
  const parar = () => {
    clearInterval(relogio)
    clearTimeout(graca)
    relogio = graca = undefined
  }
  return {
    /** Novo período; com o ciclo ativo, reprograma na hora. */
    periodo(ms: number) {
      periodoMs = ms
      if (relogio === undefined) return
      clearInterval(relogio)
      relogio = setInterval(() => void ciclo(), periodoMs)
    },
    ativo: () => relogio !== undefined,
    parar,
    /** Resolve quando o painel fecha (`signal`) ou a vigília vence; o painel renova em seguida. */
    vigiar(signal: AbortSignal): Promise<true> {
      if (signal.aborted) return Promise.resolve(true)
      clearTimeout(graca)
      graca = undefined
      vigias++
      relogio ??= setInterval(() => void ciclo(), periodoMs)
      return new Promise((resolve) => {
        const fim = () => {
          clearTimeout(vence)
          signal.removeEventListener('abort', fim)
          if (--vigias === 0) graca = setTimeout(parar, gracaMs)
          resolve(true)
        }
        const vence = setTimeout(fim, renovaMs)
        signal.addEventListener('abort', fim, { once: true })
      })
    }
  }
}
