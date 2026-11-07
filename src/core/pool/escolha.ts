import { acharAgente } from '../catalogo.ts'
import type { Paths } from '../paths.ts'
import type { Config, Conta, Medida } from '../tipos.ts'
import { medidaEfetiva, modeloEfetivo } from './modelo.ts'
import { livres, ocupadasMaquina } from './vagas.ts'

const H = 3600_000
// shortcut: janela longa fixa em 168 h (semanal); Medida não traz a duração — corrigir se houver provedor mensal.
const JANELA_LONGA_H = 168

/** Cota curta máxima (%) para qualquer escolha. */
export const CURTA_MAX = 80
/** Cota longa máxima (%) do escritor. */
export const LONGA_MAX = 80
/** Cota longa máxima (%) do escritor quando a janela longa zera em menos de `RESET_PROXIMO_H`. */
export const LONGA_MAX_RESET_PROXIMO = 95
export const RESET_PROXIMO_H = 24
/** Cota longa máxima (%) da segunda opinião. */
export const TETO_SEGUNDA = 60

const familiaDe = (agente: string): string => acharAgente(agente)?.familia ?? 'outro'

/** Dados da escolha; o texto legível (idioma) é montado por quem exibe. */
export type Escolhida = {
  conta: string
  peso: number
  semMedidor: boolean
  ritmo: number | null
  livre: number | null
  horas: number | null
  modelo: string | null
}

/** Conta ativa, com o papel, vaga no pool e máquina fora do teto. `reservada`: conta onde o chamador já tem a vaga (conta como livre). */
async function aptas(c: Config, p: Paths, papel: Conta['papeis'][number], agora: number, reservada?: string): Promise<Conta[]> {
  if (!reservada && c.pool.teto > 0 && (await ocupadasMaquina(p, c, agora)) >= c.pool.teto) return []
  const vagas = new Map((await livres(p, c, agora)).map(l => [l.conta, l]))
  return c.pool.contas.filter(ct => {
    const v = vagas.get(ct.nome)
    return ct.ativo && ct.papeis.includes(papel) && v && (v.total === 0 || v.livres > 0 || ct.nome === reservada)
  })
}

const horasAte = (ts: number | null, agora: number) => (ts === null ? -1 : (ts - agora) / H)

/**
 * Escritores possíveis do melhor para o pior: medidas por ritmo (ou ordem da tabela), depois as sem medidor.
 * `reservada`: conta que já guarda a reserva de quem pergunta; entra mesmo cheia, para repetir o pedido dar a mesma conta.
 */
export async function rankearEscritores(c: Config, medidas: Medida[], p: Paths, agora: number, reservada?: string): Promise<Escolhida[]> {
  const porConta = new Map(medidas.map(m => [m.conta, m]))
  const escolhidas: Escolhida[] = [] // na ordem da tabela
  for (const ct of await aptas(c, p, 'escritor', agora, reservada)) {
    const bruta = porConta.get(ct.nome)
    const m = bruta && medidaEfetiva(ct, bruta)
    if (m && (m.estado === 'sem_login' || m.estado === 'erro' || m.estado === 'nao_configurada')) continue
    if (!m || m.estado === 'sem_medida' || m.longa === null) {
      escolhidas.push({ conta: ct.nome, peso: ct.peso, semMedidor: true, ritmo: null, livre: null, horas: null, modelo: modeloEfetivo(ct) })
      continue
    }
    const h = horasAte(m.resetLongaTs, agora)
    const dentroDoTeto = m.longa <= LONGA_MAX || (m.longa <= LONGA_MAX_RESET_PROXIMO && h >= 0 && h < RESET_PROXIMO_H)
    if ((m.curta ?? 0) > CURTA_MAX || !dentroDoTeto) continue
    // Ritmo = % livre da semana ÷ fração da janela que falta (mín. 1%): quem zera antes pode gastar antes.
    const fracaoQueFalta = h < 0 ? 1 : Math.min(Math.max(h / JANELA_LONGA_H, 0.01), 1)
    const ritmo = (100 - m.longa) / (100 * fracaoQueFalta)
    escolhidas.push({
      conta: ct.nome,
      peso: ct.peso,
      semMedidor: false,
      ritmo: ritmo * (c.pool.escolha === 'ordem' ? 1 : ct.peso),
      livre: 100 - m.longa,
      horas: h >= 0 ? h : null,
      modelo: modeloEfetivo(ct),
    })
  }
  if (c.pool.escolha === 'ordem') return escolhidas // a ordem da tabela mistura medidas e sem medidor
  const medidos = escolhidas.filter(e => !e.semMedidor).sort((a, b) => (b.ritmo ?? 0) - (a.ritmo ?? 0)) // sort estável: empate fica na ordem da tabela
  return [...medidos, ...escolhidas.filter(e => e.semMedidor)]
}

export async function escolherEscritor(c: Config, medidas: Medida[], p: Paths, agora: number): Promise<Escolhida | null> {
  return (await rankearEscritores(c, medidas, p, agora))[0] ?? null
}

/**
 * Segunda opinião: família diferente da do escritor, curta ≤ `CURTA_MAX`, longa ≤ `teto`; vence a maior folga.
 */
export async function escolherSegunda(
  c: Config,
  medidas: Medida[],
  familiaEscritor: string,
  p: Paths,
  agora: number,
  teto = TETO_SEGUNDA,
): Promise<Escolhida | null> {
  const porConta = new Map(medidas.map(m => [m.conta, m]))
  const candidatas = await aptas(c, p, 'segunda-opiniao', agora)
  let melhor: { ct: Conta; folga: number; h: number } | null = null
  for (const ct of candidatas) {
    const fam = familiaDe(ct.agente)
    const bruta = porConta.get(ct.nome)
    const m = bruta && medidaEfetiva(ct, bruta)
    if (fam === 'outro' || fam === familiaEscritor || !m || m.estado !== 'ok' || m.longa === null) continue
    if ((m.curta ?? 0) > CURTA_MAX || m.longa > teto) continue
    const folga = 100 - m.longa
    if (!melhor || folga > melhor.folga) melhor = { ct, folga, h: horasAte(m.resetLongaTs, agora) }
  }
  if (!melhor) return null
  return {
    conta: melhor.ct.nome,
    peso: melhor.ct.peso,
    semMedidor: false,
    ritmo: null,
    livre: melhor.folga,
    horas: melhor.h >= 0 ? melhor.h : null,
    modelo: modeloEfetivo(melhor.ct),
  }
}
