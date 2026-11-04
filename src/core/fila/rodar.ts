import type { ChildProcess } from 'node:child_process'
import { constants } from 'node:os'
import { join } from 'node:path'
import type { ConfigFila } from '../tipos.ts'
import type { Paths } from '../paths.ts'
import { lancar } from '../executavel.ts'
import { detectarExecutor, type Executor } from './executores.ts'
import { limparBancosLaravel } from './limpeza.ts'
import { limitarProcessos, processosDoComando } from './processos.ts'
import { chaveFila, detectarRecurso, nomeProjeto } from './recurso.ts'
import { TETO, anotarFilho, limparTravasMortas, publicar, removerMelhorEsforco, soltarVaga, tomarVaga, vivoPadrao, type InfoTrava } from './travas.ts'

const POLL_MS = 250

/** Avisos da fila como código + dados; quem exibe (CLI) traduz. */
export type EventoFila =
  | { codigo: 'aguardando'; fila: string }
  | { codigo: 'ocupada'; fila: string }
  | { codigo: 'sem_stack' }
  | { codigo: 'falha_inicio'; comando: string; erro: string }
  | { codigo: 'processos_ajustados'; de: string | null; para: string }

export type OpcoesRodar = {
  avisar?: (e: EventoFila) => void
  dir: string
  comando?: string[]
  config: ConfigFila
  p: Paths
  env?: NodeJS.ProcessEnv
  agora?: () => number
  dormir?: (ms: number) => Promise<void>
  orfao?: (f: { pid: number; inicio: number }) => boolean
  /** Relê vagas e teto a cada volta da espera (a chave e o modo do início ficam); padrão: `config`, sem reler. */
  lerConfig?: () => ConfigFila
}

/** Roda o teste esperando a vez (vaga da fila e depois a do teto da máquina). Devolve o código do teste; 75 se a espera estourar. */
export async function rodarNaFila(o: OpcoesRodar): Promise<number> {
  const env = o.env ?? process.env
  const avisar = o.avisar ?? (() => {})
  const agora = o.agora ?? Date.now
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const { p, config } = o

  // `VAR=x cmd` vira env do filho: o spawn não interpreta atribuição.
  const atribuicoes: Record<string, string> = {}
  let argv = o.comando
  while (argv && argv.length > 1 && /^[A-Za-z_]\w*=/.test(argv[0])) {
    const i = argv[0].indexOf('=')
    atribuicoes[argv[0].slice(0, i)] = argv[0].slice(i + 1)
    argv = argv.slice(1)
  }
  const envTeste = { ...env, ...atribuicoes }
  const detectado = detectarExecutor(o.dir, envTeste)
  let comando = argv
  if (!comando) {
    if (!detectado) {
      avisar({ codigo: 'sem_stack' })
      return 2
    }
    comando = [...detectado.comando, ...detectado.paralelo(config.processos)]
  }
  const executor: Executor | null = argv ? { nome: 'custom', comando: argv, paralelo: () => [] } : detectado
  const recurso = detectarRecurso(o.dir, envTeste, executor)
  const projeto = nomeProjeto(o.dir)
  const chave = chaveFila(config.modo, recurso, projeto)
  const base = join(p.fila, chave)
  const baseTeto = join(p.fila, TETO)
  // Modo banco: 1 vaga por banco de teste, senão dois runs derrubam os bancos paralelos um do outro; sem banco (geral, container) vale fila.vagas.
  const ehBanco = recurso !== 'geral' && !recurso.startsWith('container ')
  const vagasDe = (c: ConfigFila) => (config.modo === 'projeto' ? c.vagasPorProjeto : config.modo === 'banco' && ehBanco ? 1 : c.vagas)
  let atual = config
  /** Config ilegível ou inválida: fica a última lida. */
  const reler = () => {
    try {
      if (o.lerConfig) atual = o.lerConfig()
    } catch {
      // mantém os valores anteriores
    }
  }

  const dirEspera = join(p.espera, String(process.pid))
  const info = (fila: string): InfoTrava => ({ pid: process.pid, inicio: agora(), recurso, worktree: o.dir, projeto, comando: comando.join(' '), fila })
  limparTravasMortas(p, vivoPadrao, o.orfao)

  let sinal: NodeJS.Signals | null = null
  let filho: ChildProcess | null = null
  const aoSinal = (s: NodeJS.Signals) => {
    sinal = s
    filho?.kill()
  }
  process.on('SIGINT', aoSinal)
  process.on('SIGTERM', aoSinal)

  const limite = agora() + config.esperaMaxS * 1000
  /** Pega uma vaga em `dir` esperando a vez; null se o tempo estourar ou vier sinal. */
  async function pegar(dir: string, n: () => number, nome: string): Promise<number | null> {
    let avisou = false
    try {
      for (;;) {
        reler()
        const vaga = tomarVaga(dir, n(), info(nome), vivoPadrao, o.orfao)
        if (vaga !== null) return vaga
        if (sinal || agora() >= limite) return null
        if (!avisou) {
          removerMelhorEsforco(dirEspera)
          publicar(dirEspera, info(nome))
          avisar({ codigo: 'aguardando', fila: nome })
          avisou = true
        }
        await dormir(POLL_MS)
      }
    } finally {
      removerMelhorEsforco(dirEspera)
    }
  }

  let vagaFila: number | null = null
  let vagaTeto: number | null = null
  try {
    vagaFila = await pegar(base, () => vagasDe(atual), chave)
    if (vagaFila !== null) vagaTeto = await pegar(baseTeto, () => atual.teto, TETO)
    if (vagaFila === null || vagaTeto === null) {
      if (sinal) return 128 + (constants.signals[sinal] ?? 0)
      avisar({ codigo: 'ocupada', fila: vagaFila === null ? chave : TETO })
      return 75
    }

    // Comando explícito: fila.processos (relido na espera) é teto nas flags de paralelismo do agente.
    let lancado = comando
    if (argv) {
      const r = limitarProcessos(comando, atual.processos)
      lancado = r.comando
      for (const a of r.ajustes) avisar({ codigo: 'processos_ajustados', ...a })
    }
    const code = await new Promise<number>((resolve) => {
      filho = lancar(lancado, o.dir, { CI: '1', ...envTeste })
      if (filho.pid) {
        const f = { pid: filho.pid, inicio: agora() }
        anotarFilho(join(base, String(vagaFila)), f)
        anotarFilho(join(baseTeto, String(vagaTeto)), f)
      }
      filho.on('error', (e) => {
        avisar({ codigo: 'falha_inicio', comando: comando[0], erro: e.message })
        resolve(127)
      })
      filho.on('close', (c, s) => resolve(c ?? 128 + (constants.signals[s as NodeJS.Signals] ?? 0)))
    })

    if (lancado[0] === 'php' && lancado.includes('--parallel')) {
      const n = processosDoComando(lancado) ?? config.processos
      await limparBancosLaravel(o.dir, envTeste, n).catch(() => undefined)
    }
    return code
  } finally {
    if (vagaTeto !== null) soltarVaga(baseTeto, vagaTeto)
    if (vagaFila !== null) soltarVaga(base, vagaFila)
    process.off('SIGINT', aoSinal)
    process.off('SIGTERM', aoSinal)
  }
}
