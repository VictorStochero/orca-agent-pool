import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Config, Conta, Medida, OrcaCli } from '../tipos.ts'
import type { Paths } from '../paths.ts'
import { medirClaude, type DependenciasMedida } from './claude.ts'
import { medirOrca, type CotaOrca } from './orca.ts'

function chave(conta: Conta): string {
  return createHash('sha256').update(JSON.stringify([conta.nome, conta.agente, conta.config, conta.origem])).digest('hex')
}

function formaValida(medida: Medida | undefined): medida is Medida {
  try {
    if (!medida || !Number.isFinite(medida.medidaTs)) return false
    if (!['ok', 'erro', 'sem_login', 'sem_medida'].includes(medida.estado)) return false
    if (![medida.curta, medida.longa].every(n => n === null || typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)) return false
    return medida.resetLongaTs === null || Number.isFinite(medida.resetLongaTs)
  } catch { return false }
}

function ler(medida: Medida | undefined, conta: Conta, agora: number, cacheMin: number): Medida | null {
  if (!formaValida(medida) || medida.conta !== conta.nome || medida.medidaTs > agora || agora - medida.medidaTs >= cacheMin * 60_000) return null
  return medida
}

function lerArquivo(p: Paths): Record<string, Medida> {
  try {
    const json = JSON.parse(readFileSync(join(p.medidas, 'contas.json'), 'utf8'))
    if (json && typeof json === 'object' && !Array.isArray(json)) return json
  } catch { /* Cache ausente ou ilegível exige coleta nova. */ }
  return {}
}

/** Medidas gravadas por `medirTodas`, sem medir e sem limite de idade: o worker religado mostra a cota (já marcada como antiga) até a primeira coleta. */
export function medidasGravadas(p: Paths): Medida[] {
  return Object.values(lerArquivo(p)).filter(formaValida)
}

export async function medirTodas(c: Config, p: Paths, orca: OrcaCli, d: DependenciasMedida, cacheMin = 5): Promise<Medida[]> {
  let nativas: Map<string, CotaOrca> | undefined
  let falhouOrca = false
  const medidas: Medida[] = []
  const destino = join(p.medidas, 'contas.json')
  const anteriores = lerArquivo(p)
  const atualizadas: Record<string, Medida> = {}
  let mudou = false
  for (const conta of c.pool.contas) {
    const id = chave(conta)
    const cache = ler(anteriores[id], conta, d.agora, cacheMin)
    if (cache) { medidas.push(cache); atualizadas[id] = cache; continue }
    let medida: Medida
    if (conta.agente === 'claude' && conta.origem === 'manual') {
      medida = await medirClaude(conta, d)
    } else {
      if (!nativas && !falhouOrca) {
        try { nativas = await medirOrca(orca) } catch { falhouOrca = true }
      }
      medida = {
        conta: conta.nome, medidaTs: d.agora, curta: null, longa: null, resetLongaTs: null,
        estado: falhouOrca ? 'erro' : 'sem_medida',
        ...(nativas?.get(conta.agente)),
      }
    }
    atualizadas[id] = medida
    medidas.push(medida)
    mudou = true
  }
  if (mudou) {
    mkdirSync(p.medidas, { recursive: true })
    const temporario = `${destino}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporario, JSON.stringify(atualizadas), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSync(temporario, destino)
    } finally { rmSync(temporario, { force: true }) }
  }
  return medidas
}
