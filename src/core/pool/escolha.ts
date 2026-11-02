import { acharAgente } from '../catalogo.ts'
import type { Paths } from '../paths.ts'
import type { Config, Conta, Medida } from '../tipos.ts'
import { livres, ocupadasMaquina } from './vagas.ts'

const H = 3600_000
// shortcut: janela longa fixa em 168 h (semanal); Medida não traz a duração — corrigir se houver provedor mensal.
const JANELA_LONGA_H = 168

const familiaDe = (agente: string): string => acharAgente(agente)?.familia ?? 'outro'

/** Dados da escolha; o texto legível (idioma) é montado por quem exibe. */
export type Escolhida = { conta: string; peso: number; semMedidor: boolean; ritmo: number | null; livre: number | null; horas: number | null }

/** Conta ativa, com o papel, vaga no pool e máquina fora do teto. */
function aptas(c: Config, p: Paths, papel: Conta['papeis'][number], agora: number): Conta[] {
  if (c.pool.teto > 0 && ocupadasMaquina(p, c, agora) >= c.pool.teto) return []
  const vagas = new Map(livres(p, c, agora).map((l) => [l.conta, l]))
  return c.pool.contas.filter((ct) => {
    const v = vagas.get(ct.nome)
    return ct.ativo && ct.papeis.includes(papel) && v && (v.total === 0 || v.livres > 0)
  })
}

const horasAte = (ts: number | null, agora: number) => (ts === null ? -1 : (ts - agora) / H)

/** Escritores possíveis do melhor para o pior: medidas por ritmo (ou ordem da tabela), depois as sem medidor. */
export function rankearEscritores(c: Config, medidas: Medida[], p: Paths, agora: number): Escolhida[] {
  const porConta = new Map(medidas.map((m) => [m.conta, m]))
  const medidos: { conta: Conta; ritmo: number; livre: number; h: number }[] = []
  const semMedidor: Conta[] = []
  for (const ct of aptas(c, p, 'escritor', agora)) {
    const m = porConta.get(ct.nome)
    if (m && (m.estado === 'sem_login' || m.estado === 'erro')) continue
    if (!m || m.estado === 'sem_medida' || m.longa === null) { semMedidor.push(ct); continue }
    const curta = m.curta ?? 0
    const h = horasAte(m.resetLongaTs, agora)
    if (curta > 80 || !(m.longa <= 80 || (m.longa <= 95 && h >= 0 && h < 24))) continue
    const frac = h < 0 ? 1 : Math.min(Math.max(h / JANELA_LONGA_H, 0.01), 1)
    const base = (100 - m.longa) / (100 * frac)
    medidos.push({ conta: ct, ritmo: base * (c.pool.escolha === 'ordem' ? 1 : ct.peso), livre: 100 - m.longa, h })
  }
  const doMedido = (x: (typeof medidos)[number]): Escolhida => ({ conta: x.conta.nome, peso: x.conta.peso, semMedidor: false, ritmo: x.ritmo, livre: x.livre, horas: x.h >= 0 ? x.h : null })
  const doSem = (ct: Conta): Escolhida => ({ conta: ct.nome, peso: ct.peso, semMedidor: true, ritmo: null, livre: null, horas: null })
  const ordemTabela = (ct: Conta) => c.pool.contas.indexOf(ct)
  if (c.pool.escolha === 'ordem') {
    // a ordem da tabela mistura medidas e sem medidor
    const todos = [...medidos.map((x) => ({ ct: x.conta, e: doMedido(x) })), ...semMedidor.map((ct) => ({ ct, e: doSem(ct) }))]
    return todos.sort((a, b) => ordemTabela(a.ct) - ordemTabela(b.ct)).map((x) => x.e)
  }
  medidos.sort((a, b) => b.ritmo - a.ritmo) // sort estável: empate fica na ordem da tabela
  return [...medidos.map(doMedido), ...semMedidor.map(doSem)]
}

export function escolherEscritor(c: Config, medidas: Medida[], p: Paths, agora: number): Escolhida | null {
  return rankearEscritores(c, medidas, p, agora)[0] ?? null
}

/**
 * Segunda opinião: família diferente da do escritor, curta ≤ 80, longa ≤ `teto`; vence a maior folga.
 * `p` (opcional) aplica o filtro de vagas; sem ele só cota e papel contam.
 */
export function escolherSegunda(
  c: Config, medidas: Medida[], familiaEscritor: string, agora: number, teto = 60, p?: Paths
): Escolhida | null {
  const porConta = new Map(medidas.map((m) => [m.conta, m]))
  const candidatas = p ? aptas(c, p, 'segunda-opiniao', agora) : c.pool.contas.filter((ct) => ct.ativo && ct.papeis.includes('segunda-opiniao'))
  let melhor: { ct: Conta; folga: number; h: number } | null = null
  for (const ct of candidatas) {
    const fam = familiaDe(ct.agente)
    const m = porConta.get(ct.nome)
    if (fam === 'outro' || fam === familiaEscritor || !m || m.estado !== 'ok' || m.longa === null) continue
    if ((m.curta ?? 0) > 80 || m.longa > teto) continue
    const folga = 100 - m.longa
    if (!melhor || folga > melhor.folga) melhor = { ct, folga, h: horasAte(m.resetLongaTs, agora) }
  }
  if (!melhor) return null
  return { conta: melhor.ct.nome, peso: melhor.ct.peso, semMedidor: false, ritmo: null, livre: melhor.folga, horas: melhor.h >= 0 ? melhor.h : null }
}
