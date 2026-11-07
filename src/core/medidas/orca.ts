import type { Limite, Medida, OrcaCli } from '../tipos.ts'
import { percentual } from './percentual.ts'

export type CotaOrca = Omit<Medida, 'conta' | 'medidaTs'>

const SEM_LOGIN = /not (?:signed|logged) in|credentials not found|no .+sign-in|credentials.+not configured/i

function estadoDe(r: { status?: string; error?: string; usageMetadata?: { failureKind?: string } }, temMedida: boolean): Medida['estado'] {
  if (r.status === 'ok') return temMedida ? 'ok' : 'sem_medida'
  const semLogin = r.usageMetadata?.failureKind === 'missing-credentials' || (typeof r.error === 'string' && SEM_LOGIN.test(r.error))
  return semLogin ? 'sem_login' : 'erro'
}

export async function medirOrca(orca: OrcaCli): Promise<Map<string, CotaOrca>> {
  let dados: { rateLimits?: Record<string, unknown> }
  try {
    const resposta = await orca.run(['account', 'list', '--json'])
    if (resposta.code !== 0) throw new Error()
    const envelope = JSON.parse(resposta.stdout)
    if (envelope.ok === false) throw new Error()
    dados = envelope.result ?? envelope
    if (!dados || typeof dados !== 'object') throw new Error()
  } catch {
    throw new Error('orca_usage_unavailable')
  }

  const medidas = new Map<string, CotaOrca>()
  for (const [chave, valor] of Object.entries(dados.rateLimits ?? {})) {
    if (!valor || typeof valor !== 'object' || !('provider' in valor)) continue
    const r = valor as {
      provider: string
      status?: string
      error?: string
      session?: { usedPercent?: number }
      weekly?: { usedPercent?: number; resetsAt?: number }
      buckets?: { group?: string; usedPercent?: number; windowMinutes?: number }[]
      usageMetadata?: { failureKind?: string }
    }
    const ok = r.status === 'ok'
    const curta = ok ? percentual(r.session?.usedPercent) : null
    const longa = ok ? percentual(r.weekly?.usedPercent) : null
    // Um grupo só repete a linha da conta: só monta a lista com 2 ou mais.
    const grupos = new Map<string, Limite>()
    for (const b of ok && Array.isArray(r.buckets) ? r.buckets : []) {
      if (typeof b?.group !== 'string' || !b.group || (b.windowMinutes !== 300 && b.windowMinutes !== 10080)) continue
      const g = grupos.get(b.group) ?? { nome: b.group, curta: null, longa: null }
      g[b.windowMinutes === 300 ? 'curta' : 'longa'] = percentual(b.usedPercent)
      grupos.set(b.group, g)
    }
    medidas.set(r.provider || chave, {
      curta,
      longa,
      ...(grupos.size >= 2 ? { limites: [...grupos.values()] } : {}),
      resetLongaTs: ok && typeof r.weekly?.resetsAt === 'number' && Number.isFinite(r.weekly.resetsAt) ? r.weekly.resetsAt : null,
      estado: estadoDe(r, curta !== null || longa !== null),
    })
  }
  return medidas
}
