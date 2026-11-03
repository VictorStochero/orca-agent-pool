import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Paths } from '../paths.ts'
import { adquirir, publicarArquivos } from '../fila/travas.ts'
import { pastaDaConta } from '../medidas/claude.ts'
import { agentesVivos } from '../sessoes.ts'
import type { Config, OrcaCli } from '../tipos.ts'

/** Reserva provisória (`res-<tag>`) vive 10 min; depois qualquer leitura a considera livre. */
export const TTL_RESERVA_MS = 600_000
const TERMINAIS = ['completed', 'failed', 'stopped', 'abandoned']
const DONO = /^[a-zA-Z0-9_-]+$/

export type Vaga = { dir: string; conta: string; dono: string; desde: number }

export class TravaOcupada extends Error {}

function ler(arq: string): string {
  try {
    return readFileSync(arq, 'utf8').trim()
  } catch {
    return ''
  }
}

/** Serializa contagem + reserva entre processos (agentes distintos disputando a última vaga). */
function comTrava<T>(p: Paths, fn: () => T): T {
  mkdirSync(p.vagas, { recursive: true })
  const alvo = join(p.vagas, '.maquina')
  if (!adquirir(alvo, 10_000)) throw new TravaOcupada('maquina')
  try {
    return fn()
  } finally {
    rmSync(alvo, { recursive: true, force: true })
  }
}

export function lerVagas(p: Paths): Vaga[] {
  let nomes: string[]
  try {
    nomes = readdirSync(p.vagas)
  } catch {
    return []
  }
  const r: Vaga[] = []
  for (const nome of nomes) {
    const m = /^(.+)\.lock(\d+)$/.exec(nome)
    if (!m) continue
    const dir = join(p.vagas, nome)
    r.push({ dir, conta: m[1], dono: ler(join(dir, 'dispatch')), desde: Number(ler(join(dir, 'desde'))) })
  }
  return r
}

function expirada(v: Vaga, agora: number): boolean {
  // desde ilegível conserva a vaga
  return v.dono.startsWith('res-') && Number.isFinite(v.desde) && agora - v.desde > TTL_RESERVA_MS
}

/** Agentes vivos (`--agent <papel>`) por conta Claude manual; a mesma pasta em duas contas fica com a primeira. */
export function agentesPorConta(p: Paths, c: Config): Map<string, string[]> {
  const porConta = new Map<string, string[]>()
  const vistas = new Set<string>()
  for (const ct of c.pool.contas) {
    if (ct.agente !== 'claude' || ct.origem !== 'manual') continue
    const pasta = resolve(pastaDaConta(ct, p.home))
    if (vistas.has(pasta)) continue
    vistas.add(pasta)
    porConta.set(ct.nome, agentesVivos(pasta))
  }
  return porConta
}

/**
 * Ocupação por conta = o maior entre reservas com dispatch e agentes vivos, mais as reservas `res-`
 * (agente que ainda não abriu); `maquina` soma as contas e as reservas de conta que saiu da config
 * (worker vivo em conta inativa também segue consumindo RAM).
 */
// shortcut: o máximo subconta quando reservas com dispatch e agentes são conjuntos disjuntos (worker aberto por `worker-start --agent claude`, sem `--agent <papel>`, com reserva, mais agente sem reserva); corrigir juntando pelo cwd do worktree do dispatch.
function ocupacao(p: Paths, c: Config, vivas: Vaga[], agentes = agentesPorConta(p, c)) {
  const porConta = new Map(c.pool.contas.map((ct) => {
    const doConta = vivas.filter((v) => v.conta === ct.nome)
    const provisorias = doConta.filter((v) => v.dono.startsWith('res-')).length
    return [ct.nome, Math.max(doConta.length - provisorias, agentes.get(ct.nome)?.length ?? 0) + provisorias]
  }))
  const orfas = vivas.filter((v) => !porConta.has(v.conta)).length
  return { agentes, porConta, maquina: [...porConta.values()].reduce((a, b) => a + b, 0) + orfas }
}

/** Uma leitura de vagas e sessões: reservas vivas (sem as vencidas) e a ocupação delas. */
export function ocupacaoViva(p: Paths, c: Config, agora = Date.now()) {
  const vivas = lerVagas(p).filter((v) => !expirada(v, agora))
  return { vivas, ...ocupacao(p, c, vivas) }
}

export function ocupadasMaquina(p: Paths, c: Config, agora = Date.now()): number {
  return ocupacaoViva(p, c, agora).maquina
}

/** Há reserva `res-` pendente e dentro do TTL? É o que libera `worker-start` no hook. */
export function temReservaViva(p: Paths, agora = Date.now()): boolean {
  return lerVagas(p).some((v) => v.dono.startsWith('res-') && !expirada(v, agora))
}

function remover(v: Vaga): void {
  rmSync(v.dir, { recursive: true, force: true })
}

/**
 * Reserva uma vaga para `dono`. `ramGb` (de ramLivreGb) é medido por quem chama: esta função é síncrona.
 * Conta desconhecida ou dono inválido lançam; trava da máquina presa por mais de 10 s devolve 'cheio'.
 */
export function pegar(
  p: Paths, c: Config, conta: string, dono: string, agora = Date.now(), ramGb: number | null = null
): 'ok' | 'cheio' | 'inativa' | 'memoria' {
  if (!DONO.test(dono)) throw new Error('dono inválido')
  const ct = c.pool.contas.find((x) => x.nome === conta)
  if (!ct) throw new Error(`conta desconhecida: ${conta}`)
  if (!ct.ativo) return 'inativa'
  // Sessões não dependem da trava e a conferência de procStart pode levar segundos: lê antes de travar.
  const agentes = agentesPorConta(p, c)
  try {
    return comTrava(p, () => {
      const todas = lerVagas(p)
      for (const v of todas.filter((x) => expirada(x, agora))) remover(v)
      const vivas = todas.filter((x) => !expirada(x, agora))
      const doConta = vivas.filter((v) => v.conta === conta)
      if (doConta.some((v) => v.dono === dono)) return 'ok'
      const oc = ocupacao(p, c, vivas, agentes)
      let total = ct.vagas
      if (c.pool.teto > 0) {
        if (oc.maquina >= c.pool.teto) return 'cheio'
        if (total === 0) total = c.pool.teto
      }
      if (total > 0 && (oc.porConta.get(conta) ?? 0) >= total) return 'cheio'
      if (c.pool.ramMinGb > 0 && ramGb !== null && ramGb < c.pool.ramMinGb) return 'memoria'
      // total 0 = sem limite: grava a ocupação no primeiro índice livre, para o status contar e o swap achar a reserva
      for (let n = 1; total === 0 || n <= total; n++) {
        if (publicarArquivos(join(p.vagas, `${conta}.lock${n}`), { dispatch: dono, desde: String(agora) })) return 'ok'
      }
      return 'cheio'
    })
  } catch (e) {
    if (e instanceof TravaOcupada) return 'cheio'
    throw e
  }
}

/** Troca o dono provisório pelo dispatch real; true se a vaga já é do dispatch ou foi trocada. */
export function trocar(p: Paths, prov: string, dispatch: string, agora = Date.now()): boolean {
  if (!DONO.test(prov) || !DONO.test(dispatch)) throw new Error('dono inválido')
  return comTrava(p, () => {
    const vagas = lerVagas(p)
    if (vagas.some((v) => v.dono === dispatch)) return true
    const v = vagas.find((x) => x.dono === prov)
    if (!v) return false
    const tmp = join(v.dir, `dispatch.novo.${process.pid}`)
    writeFileSync(tmp, dispatch)
    renameSync(tmp, join(v.dir, 'dispatch'))
    writeFileSync(join(v.dir, 'desde'), String(agora))
    return true
  })
}

/** Libera toda vaga do dono, mesmo de conta que saiu da config. */
export function soltar(p: Paths, dono: string): void {
  if (!DONO.test(dono)) throw new Error('dono inválido')
  comTrava(p, () => lerVagas(p).filter((v) => v.dono === dono).forEach(remover))
}

export function livres(p: Paths, c: Config, agora = Date.now()): { conta: string; livres: number; ocupadas: number; total: number; inativa: boolean }[] {
  const oc = ocupacaoViva(p, c, agora)
  return c.pool.contas.map((ct) => {
    const ocupadas = oc.porConta.get(ct.nome) ?? 0
    if (!ct.ativo) return { conta: ct.nome, livres: 0, ocupadas, total: ct.vagas, inativa: true }
    // vagas 0 = ilimitado: sem contagem de livres (quem escolhe trata total 0 como livre)
    return { conta: ct.nome, livres: ct.vagas === 0 ? 0 : Math.max(ct.vagas - ocupadas, 0), ocupadas, total: ct.vagas, inativa: false }
  })
}

/**
 * Libera vagas de dispatch encerrado e reservas `res-` vencidas. `encerrado` devolve true só com
 * evidência explícita; false/undefined (inclusive falha de transporte) conserva a vaga.
 */
export async function recuperar(
  p: Paths, c: Config, encerrado: (dispatch: string) => Promise<boolean | undefined>, agora = Date.now()
): Promise<number> {
  void c
  const mortas = new Set<string>()
  const candidatas = lerVagas(p)
  for (const v of candidatas) {
    if (v.dono.startsWith('res-') || !v.dono) continue
    if ((await encerrado(v.dono)) === true) mortas.add(v.dono)
  }
  return comTrava(p, () => {
    let n = 0
    for (const v of lerVagas(p)) {
      if (expirada(v, agora) || mortas.has(v.dono)) {
        remover(v)
        n++
      }
    }
    return n
  })
}

/**
 * Consulta de dispatch encerrado no Orca (lista dos workers; ausente cai no worker-show).
 * Crie um por ciclo: a lista é lida uma vez.
 */
export function encerradoNoOrca(orca: OrcaCli): (dispatch: string) => Promise<boolean | undefined> {
  let lista: Map<string, string> | null | undefined
  const json = async (args: string[]) => {
    try {
      const r = await orca.run(args, { timeoutMs: 20_000 })
      return { code: r.code, doc: JSON.parse(r.stdout) as any }
    } catch {
      return null
    }
  }
  return async (dispatch) => {
    if (lista === undefined) {
      const r = await json(['orchestration', 'worker-list', '--json', '--full'])
      lista = r?.doc?.ok === true && Array.isArray(r.doc.result?.workers)
        ? new Map(r.doc.result.workers.map((w: any) => [String(w.dispatchId), String(w.dispatchStatus ?? '-')]))
        : null
    }
    const estado = lista?.get(dispatch)
    if (estado !== undefined) return TERMINAIS.includes(estado)
    const r = await json(['orchestration', 'worker-show', '--dispatch', dispatch, '--json', '--full'])
    if (!r) return undefined
    if (r.doc?.ok === false) return r.doc.error?.code === 'dispatch_not_found' ? true : undefined
    const d = r.doc?.result?.dispatch
    if (r.doc?.ok === true && d?.id === dispatch) return TERMINAIS.includes(d.status)
    return undefined
  }
}
