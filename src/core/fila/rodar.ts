import type { ChildProcess } from 'node:child_process'
import { constants } from 'node:os'
import { join } from 'node:path'
import { lancar, separarAtribuicoes } from '../executavel.ts'
import type { Paths } from '../paths.ts'
import type { ConfigFila } from '../tipos.ts'
import { anotar, esperar, type InfoTrava, publicar, removerMelhorEsforco, vivoPadrao } from '../trava.ts'
import { detectarExecutor, type Executor } from './executores.ts'
import { aquecerOrfaos } from './orfao.ts'
import { comLimpezaDeBancos, limitarProcessos } from './processos.ts'
import { chaveFila, detectarRecurso, nomeProjeto } from './recurso.ts'
import { acompanharSaida } from './saida.ts'
import { limparTravasMortas, soltarVaga, TETO, tomarVaga } from './travas.ts'

const POLL_MS = 250
const GRAVAR_SAIDA_MS = 1000

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
  /** Consulta dos órfãos antes de ler as travas; padrão: `aquecerOrfaos` (nada, se `orfao` vier injetado). */
  aquecer?: () => Promise<void>
  /** Relê vagas e teto a cada volta da espera (a chave e o modo do início ficam); padrão: `config`, sem reler. */
  lerConfig?: () => ConfigFila
}

/** `VAR=x cmd` vira env do filho (o spawn não interpreta atribuição); `FOO=bar` sozinho segue sendo o comando. */
function prepararComando(palavras: string[], env: NodeJS.ProcessEnv): { argv: string[]; envTeste: NodeJS.ProcessEnv } {
  let { vars, resto } = separarAtribuicoes(palavras)
  if (vars.length && !resto.length) {
    resto = palavras.slice(-1)
    vars = vars.slice(0, -1)
  }
  return { argv: resto, envTeste: { ...env, ...Object.fromEntries(vars) } }
}

/** Roda o teste esperando a vez (vaga da fila e depois a do teto da máquina). Devolve o código do teste; 75 se a espera estourar. */
export async function rodarNaFila(o: OpcoesRodar): Promise<number> {
  const env = o.env ?? process.env
  const avisar = o.avisar ?? (() => {})
  const agora = o.agora ?? Date.now
  const dormir = o.dormir ?? esperar
  const { p, config } = o

  const { argv, envTeste } = prepararComando(o.comando ?? [], env)
  const executor: Executor | null = argv.length ? { nome: 'custom', comando: argv, paralelo: () => [] } : detectarExecutor(o.dir)
  if (!executor) {
    avisar({ codigo: 'sem_stack' })
    return 2
  }
  const recurso = detectarRecurso(o.dir, envTeste, executor)
  const projeto = nomeProjeto(o.dir)
  const chave = chaveFila(config.modo, recurso, projeto)
  const base = join(p.fila, chave)
  const baseTeto = join(p.fila, TETO)
  // Modo banco: 1 vaga por banco de teste, senão dois runs derrubam os bancos paralelos um do outro; sem banco (geral, container) vale fila.vagas.
  const ehBanco = recurso !== 'geral' && !recurso.startsWith('container ')
  const vagasDe = (c: ConfigFila) => {
    if (config.modo === 'projeto') return c.vagasPorProjeto
    return config.modo === 'banco' && ehBanco ? 1 : c.vagas
  }
  let atual = config
  /** Config ilegível ou inválida: fica a última lida. */
  const reler = () => {
    try {
      if (o.lerConfig) atual = o.lerConfig()
    } catch {
      // mantém os valores anteriores
    }
  }

  /** fila.processos relido na espera: teto nas flags de paralelismo do comando explícito; paralelismo do executor detectado. */
  const ajustado = () => {
    const r = argv.length
      ? limitarProcessos(argv, atual.processos)
      : { comando: [...executor.comando, ...executor.paralelo(atual.processos)], ajustes: [] }
    // Apagar banco é alteração na máquina: só com fila.limpar_bancos ligado pelo usuário.
    return atual.limparBancos ? { ...r, comando: comLimpezaDeBancos(r.comando) } : r
  }
  const dirEspera = join(p.espera, String(process.pid))
  const info = (fila: string): InfoTrava => ({
    pid: process.pid,
    inicio: agora(),
    recurso,
    worktree: o.dir,
    projeto,
    comando: ajustado().comando.join(' '),
    fila,
  })
  /** Consulta os órfãos do Windows antes da leitura das travas (que só olha o cache); `o.orfao` injetado dispensa. */
  const aquecer = o.aquecer ?? (() => (o.orfao ? Promise.resolve() : aquecerOrfaos(p, vivoPadrao)))
  await aquecer()
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
    let publicado: string | null = null
    try {
      for (;;) {
        // O sinal é conferido depois da última espera antes do tomarVaga (o aquecimento; o dormir fecha a volta
        // anterior), senão a vaga que abre lança o teste de um agente já interrompido.
        await aquecer()
        if (sinal) return null
        reler()
        const i = info(nome)
        const vaga = tomarVaga(dir, n(), i, vivoPadrao, o.orfao)
        if (vaga !== null) return vaga
        if (agora() >= limite) return null
        if (!avisou) {
          removerMelhorEsforco(dirEspera)
          publicar(dirEspera, i)
          avisar({ codigo: 'aguardando', fila: nome })
          avisou = true
        } else if (i.comando !== publicado) anotar(dirEspera, { comando: i.comando })
        publicado = i.comando
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

    const { comando: lancado, ajustes } = ajustado()
    for (const a of ajustes) avisar({ codigo: 'processos_ajustados', ...a })
    const code = await new Promise<number>(resolve => {
      filho = lancar(lancado, o.dir, { CI: '1', ...envTeste }, ['inherit', 'pipe', 'pipe'])
      const dirs = [join(base, String(vagaFila)), join(baseTeto, String(vagaTeto))]
      if (filho.pid) {
        const f = { pid: filho.pid, inicio: agora() }
        for (const d of dirs) anotar(d, { filho: f, comando: lancado.join(' ') })
      }
      // Grava a primeira saída na hora e depois no máximo 1x/s; a última fica pendente num timer.
      const acomp = acompanharSaida(agora)
      let ultima = 0
      let pendente: NodeJS.Timeout | null = null
      const gravar = () => {
        pendente = null
        ultima = agora()
        const saida = acomp.estado()
        if (saida) for (const d of dirs) anotar(d, { saida })
      }
      const aoChunk = (fonte: 'out' | 'err') => (chunk: Buffer) => {
        // Bytes crus ao terminal: o filho pode escrever em codepage e recodificar corromperia.
        const destino = fonte === 'out' ? process.stdout : process.stderr
        try {
          destino.write(chunk, () => {})
        } catch {
          // EPIPE no pai não derruba o teste
        }
        acomp.receber(fonte, chunk)
        if (pendente) return
        const espera = ultima + GRAVAR_SAIDA_MS - agora()
        if (espera <= 0) gravar()
        else pendente = setTimeout(gravar, espera)
      }
      filho.stdout?.on('data', aoChunk('out'))
      filho.stderr?.on('data', aoChunk('err'))
      filho.on('error', e => {
        if (pendente) clearTimeout(pendente)
        avisar({ codigo: 'falha_inicio', comando: lancado[0], erro: e.message })
        resolve(127)
      })
      filho.on('close', (c, s) => {
        if (pendente) clearTimeout(pendente)
        resolve(c ?? 128 + (constants.signals[s as NodeJS.Signals] ?? 0))
      })
    })

    return code
  } finally {
    if (vagaTeto !== null) soltarVaga(baseTeto, vagaTeto)
    if (vagaFila !== null) soltarVaga(base, vagaFila)
    process.off('SIGINT', aoSinal)
    process.off('SIGTERM', aoSinal)
  }
}
