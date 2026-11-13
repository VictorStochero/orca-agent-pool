// Worker do plugin: casca fina sobre o núcleo. Serve o painel e mede a cota no ciclo; lançador, skill e hooks só se instalam pelo clique em Requisitos.
import { existsSync, type FSWatcher, mkdirSync, rmSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OrcaWorkerApi } from 'orca/worker'
import { atualizarConfig, carregar, ErroConfig, PADRAO } from '../core/config.ts'
import { aplicar } from '../core/config-chaves.ts'
import { detectar, sincronizarDetectadas } from '../core/deteccao.ts'
import { limparTravasMortasAsync } from '../core/fila/travas.ts'
import { caminhoLancador } from '../core/lancador.ts'
import { importarLegado } from '../core/legado.ts'
import { medidasGravadas, medirTodas } from '../core/medidas/cache.ts'
import { caminhoDeBusca, criarOrcaCli } from '../core/orca.ts'
import { paths } from '../core/paths.ts'
import { ramLivreGb } from '../core/pool/memoria.ts'
import { encerradoNoOrca, recuperar } from '../core/pool/vagas.ts'
import type { Config } from '../core/tipos.ts'
import { AGENTES_HOOK, type AgenteHook, removerHooks } from '../hooks/comum.ts'
import { CHAVE_INTERVALO } from '../protocol.ts'
import { criarCiclo, intervaloMs } from './ciclo.ts'
import { AMBIENTE_VAZIO, type Ambiente, montarEstado } from './estado.ts'
import { configOuNull, criarInstalacao, falha } from './instalacao.ts'
import { criarRequisitos } from './requisitos.ts'
import { removerSkill } from './skill.ts'

const DEBOUNCE_MS = 300
const RAIZ_PLUGIN = fileURLToPath(new URL('../../', import.meta.url))

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e))
// Erro de config vai ao painel como `chave: codigo` (o painel traduz); erro de SO segue cru.
const textoConfig = (e: unknown) => (e instanceof ErroConfig ? e.erros.map(x => `${x.chave}: ${x.codigo}`).join('; ') : mensagem(e))

const observadores: FSWatcher[] = []
const inscricoes: { dispose(): void }[] = []
let adiado: ReturnType<typeof setTimeout> | undefined
let vigia: ReturnType<typeof criarCiclo> | undefined

export default function activate(orca: OrcaWorkerApi): void {
  const home = homedir()
  const p = paths(home)
  const cli = criarOrcaCli()
  const lancador = caminhoLancador(p.bin)
  const origemSkill = join(RAIZ_PLUGIN, 'skill', 'agent-pool')
  let ambiente: Ambiente = { ...AMBIENTE_VAZIO, medidas: medidasGravadas(p) }
  // Depois do Desinstalar o ciclo não roda mais: recriaria a config que acabou de sair.
  // shortcut: reinstalar na mesma sessão não religa coleta nem observação; volta quando o worker reinicia.
  let desinstalado = false

  const lerConfig = (): Config => {
    try {
      return carregar(p)
    } catch (e) {
      throw falha('config_recusada', textoConfig(e))
    }
  }
  // Config ilegível não derruba o painel: mostra o padrão e um alerta; gravar continua recusado por lerConfig.
  const estado = async () => {
    let c = PADRAO
    let erro: string | null = null
    try {
      c = carregar(p)
    } catch (e) {
      erro = textoConfig(e)
    }
    return montarEstado(p, c, erro, ambiente)
  }
  const avisar = () => orca.panels.post('estado.mudou', { em: Date.now() })

  // --- instalação (só pelos botões do painel) ---
  const rodarOrca = async (args: string[]) => {
    const r = await cli.run(args)
    if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || `orca_saiu:${r.code}`)
    return r.stdout
  }
  const instalacao = criarInstalacao({ home, p, lancador, origemSkill, raizPlugin: RAIZ_PLUGIN, log: orca.log, lerConfig, orca: rodarOrca })
  const requisitos = criarRequisitos({
    orca: rodarOrca,
    skill: () => ({ estado: instalacao.estadoSkill() }),
    lancador: instalacao.estadoLancador,
    caminhoLancador: instalacao.caminhoLancador,
    hooks: instalacao.hooksExigidos,
    arquivos: instalacao.arquivos,
    instalar: instalacao.instalar,
  })

  // --- ciclo: detecção, medição e recuperação de vagas (único lugar que mede) ---
  const coletar = async (cacheMin?: number) => {
    if (desinstalado) return
    await limparTravasMortasAsync(p)
    const c = configOuNull(p)
    if (!c) return // config ilegível: não mede nem sobrescreve
    const path = await caminhoDeBusca()
    const detectadas = await detectar(cli, path)
    // Relê sob a trava: uma gravação do painel durante a detecção não é desfeita.
    let novo = sincronizarDetectadas(c, detectadas)
    if (JSON.stringify(novo) !== JSON.stringify(c))
      novo = await atualizarConfig(
        p,
        atual => sincronizarDetectadas(atual, detectadas),
        () => importarLegado(home),
      )
    const medidas = await medirTodas(novo, p, cli, { home, fetch, agora: Date.now(), path }, cacheMin)
    await recuperar(p, encerradoNoOrca(cli))
    const ramGb = await ramLivreGb(cli)
    const v = await cli.run(['--version'])
    ambiente = {
      medidas,
      detectadas,
      ramGb,
      // `diagnostics` precisa do app em execução; o `--version` responde mesmo com o Orca fechado.
      orca: { rodando: ramGb !== null, versao: v.code === 0 ? (/\d+\.\d+\.\d+\S*/.exec(v.stdout)?.[0] ?? null) : null },
    }
  }
  // Uma coleta por vez, guardada para o Desinstalar esperar o fim dela antes de apagar a pasta de dados.
  let coleta: Promise<void> | undefined
  const atualizar = (cacheMin?: number) =>
    (coleta ??= coletar(cacheMin).finally(() => {
      coleta = undefined
    }))
  vigia = criarCiclo({ coletar: atualizar, avisar, erro: orca.log })

  // --- handlers ---
  orca.panels.handle('estado.ler', () => estado())
  // A coleta em curso pode ter usado o cache: espera ela e mede de novo, sem cache; um pedido repetido entra na medição forçada em curso.
  // O aviso alcança os outros painéis e o que já desistiu pelo teto de 120 s do pedido.
  let forcada: Promise<void> | undefined
  orca.panels.handle('cotas.medir', async () => {
    forcada ??= (async () => {
      await coleta?.catch(() => undefined)
      await atualizar(0)
      avisar()
    })().finally(() => {
      forcada = undefined
    })
    await forcada
    return estado()
  })
  orca.panels.handle('config.gravar', async ({ valores }) => {
    const pares = Object.entries(valores ?? {})
    if (pares.length === 0 || pares.some(([k, v]) => typeof k !== 'string' || typeof v !== 'string')) throw falha('config_vazia', '')
    try {
      instalacao.removerRastroDasContas(valores)
      await atualizarConfig(
        p,
        c => aplicar(c, valores),
        () => importarLegado(home),
      )
    } catch (e) {
      throw e instanceof ErroConfig ? falha('config_recusada', textoConfig(e)) : e
    }
    // Conta nova ou com outra pasta: nada é gravado nela; os requisitos passam a mostrar o que falta.
    requisitos.invalidar()
    return estado()
  })
  orca.panels.handle('requisitos.ler', entrada => (entrada?.forcar === true ? requisitos.reler() : requisitos.ler()))
  orca.panels.handle('requisitos.instalar', ({ id }) =>
    requisitos.instalar(id).catch(e => {
      orca.log(`requisitos.instalar ${String(id)}: ${mensagem(e)}`)
      throw e
    }),
  )
  orca.panels.handle('auto.assistir', (_entrada, { signal }) => vigia!.vigiar(signal))

  const agenteHook = (agente: unknown): AgenteHook => {
    if (!AGENTES_HOOK.includes(agente as AgenteHook)) throw falha('agente_invalido', String(agente))
    return agente as AgenteHook
  }
  orca.panels.handle('hooks.estado', () => instalacao.listaHooks())
  orca.panels.handle('hooks.remover', ({ agente }) => {
    const r = removerHooks(home, [agenteHook(agente)], instalacao.pastasParaRemover()).find(x => x.estado === 'erro')
    if (r) throw falha('hooks_falhou', `${r.pasta}: ${r.erro ?? 'erro'}`)
    requisitos.invalidar()
    return instalacao.listaHooks()
  })
  orca.panels.handle('hooks.reinstalar', ({ agente }) => {
    try {
      instalacao.instalarHooksAgora(lerConfig(), [agenteHook(agente)])
    } catch (e) {
      throw (e as { code?: string }).code ? e : falha('hooks_falhou', mensagem(e))
    }
    requisitos.invalidar()
    return instalacao.listaHooks()
  })
  // Hooks primeiro: se um arquivo de agente falhar, nada mais é apagado (o backup do original fica em state/backup).
  orca.panels.handle('desinstalar', async () => {
    const pastas = instalacao.pastasParaRemover()
    const erro = removerHooks(home, [...AGENTES_HOOK], pastas).find(x => x.estado === 'erro')
    if (erro) throw falha('hooks_falhou', `${erro.pasta}: ${erro.erro ?? 'erro'}`)
    removerSkill(home, pastas)
    for (const nome of ['agent-pool', 'agent-pool.cmd']) rmSync(join(p.bin, nome), { force: true })
    // Sem ciclo e sem observar antes de apagar: no Windows uma pasta observada não sai, e a coleta recriaria a config.
    desinstalado = true
    vigia?.parar()
    clearTimeout(adiado)
    for (const o of observadores.splice(0)) o.close()
    await coleta?.catch(() => undefined) // uma coleta em curso gravaria de novo em p.raiz
    rmSync(p.raiz, { recursive: true, force: true })
    requisitos.invalidar()
    orca.log('desinstalado: hooks, skill, lançador e ~/.agents/agent-pool removidos')
    return { ok: true as const }
  })

  // --- intervalo guardado ---
  const lerIntervalo = async () => {
    try {
      vigia?.periodo(intervaloMs(await orca.storage.get(CHAVE_INTERVALO)))
    } catch (e) {
      orca.log(`sem intervalo guardado, usa 60 s: ${mensagem(e)}`)
    }
  }
  void lerIntervalo()
  inscricoes.push(orca.storage.onDidChange(({ key }) => key === CHAVE_INTERVALO && void lerIntervalo()))

  // --- observação do disco ---
  const mudou = () => {
    clearTimeout(adiado)
    adiado = setTimeout(avisar, DEBOUNCE_MS)
  }
  mkdirSync(p.state, { recursive: true })
  const observa = (pasta: string, filtro: (nome: string) => boolean, recursivo: boolean) => {
    try {
      observadores.push(watch(pasta, { recursive: recursivo }, (_evento, nome) => filtro((nome ?? '').toString()) && mudou()))
    } catch (e) {
      orca.log(`sem observação de ${pasta}: ${mensagem(e)}`)
    }
  }
  observa(p.state, nome => !nome.startsWith('backup'), true)
  observa(p.raiz, nome => nome === 'config.json', false)

  // --- ativação: legado e config. Nada fora de ~/.agents/agent-pool é gravado sem o clique do usuário em Requisitos. ---
  void (async () => {
    try {
      if (!existsSync(p.config)) {
        const legado = importarLegado(home)
        if (legado) await atualizarConfig(p, () => legado)
      }
      await atualizar()
    } catch (e) {
      orca.log(`ativação: ${mensagem(e)}`)
    }
    avisar()
  })()
}

export function deactivate(): void {
  clearTimeout(adiado)
  vigia?.parar()
  for (const i of inscricoes.splice(0)) i.dispose()
  vigia = undefined
  for (const o of observadores.splice(0)) o.close()
}
