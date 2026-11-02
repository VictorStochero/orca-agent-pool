import type { Medida, OrcaCli } from '../tipos.ts'

export type CotaOrca = Omit<Medida, 'conta' | 'medidaTs'>

export async function medirOrca(orca: OrcaCli): Promise<Map<string, CotaOrca>> {
  let dados
  try {
    const resposta = await orca.run(['account', 'list', '--json'])
    if (resposta.code !== 0) throw new Error()
    const envelope = JSON.parse(resposta.stdout)
    if (envelope.ok === false) throw new Error()
    dados = envelope.result ?? envelope
    if (!dados || typeof dados !== 'object') throw new Error()
  } catch { throw new Error('orca_usage_unavailable') }

  const medidas = new Map<string, CotaOrca>()
  for (const [chave, valor] of Object.entries(dados.rateLimits ?? {})) {
    if (!valor || typeof valor !== 'object' || !('provider' in valor)) continue
    const r = valor as { provider: string; status?: string; error?: string; session?: { usedPercent?: number }; weekly?: { usedPercent?: number; resetsAt?: number }; usageMetadata?: { failureKind?: string } }
    const ok = r.status === 'ok'
    const percentual = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
    const curta = ok ? percentual(r.session?.usedPercent) : null
    const longa = ok ? percentual(r.weekly?.usedPercent) : null
    medidas.set(r.provider || chave, {
      curta, longa,
      resetLongaTs: ok && typeof r.weekly?.resetsAt === 'number' && Number.isFinite(r.weekly.resetsAt) ? r.weekly.resetsAt : null,
      estado: ok ? (curta === null && longa === null ? 'sem_medida' : 'ok') : r.usageMetadata?.failureKind === 'missing-credentials' || typeof r.error === 'string' && /not (?:signed|logged) in|credentials not found|no .+sign-in|credentials.+not configured/i.test(r.error) ? 'sem_login' : 'erro',
    })
  }
  return medidas
}
