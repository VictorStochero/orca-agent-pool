// Worker do plugin: casca fina sobre o núcleo. Serve o painel, mede a cota no ciclo e instala lançador, skill e hooks ao ativar.
import { existsSync, mkdirSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OrcaWorkerApi } from 'orca/worker'
import { aplicar, atualizarConfig, carregar, ErroConfig, PADRAO } from '../core/config.ts'
import { detectar, sincronizarDetectadas } from '../core/deteccao.ts'
import { medidasGravadas, medirTodas } from '../core/medidas/cache.ts'
import { versao } from '../core/index.ts'
import { importarLegado } from '../core/legado.ts'
import { criarOrcaCli } from '../core/orca.ts'
import { paths } from '../core/paths.ts'
import { ramLivreGb } from '../core/pool/memoria.ts'
import { encerradoNoOrca, recuperar } from '../core/pool/vagas.ts'
import type { Config } from '../core/tipos.ts'
import { AGENTES_HOOK, agentesComHook, estadoHooks, instalarHooks, pastasDasContas, removerHooks, type AgenteHook, type Pastas } from '../hooks/comum.ts'
import type { EstadoHookAgente } from '../protocol.ts'
import { criarCiclo, intervaloMs } from './ciclo.ts'
import { AMBIENTE_VAZIO, montarEstado, type Ambiente } from './estado.ts'
import { instalarLancador } from './lancador.ts'
import { criarRequisitos, type IdInstalavel } from './requisitos.ts'
import { estadoSkill, instalarSkill, removerLinks } from './skill.ts'

const DEBOUNCE_MS = 300
const CHAVE_INTERVALO = 'atualizacao.intervalo_s'
const CHAVE_REMOVIDOS = 'hooks.removidos'
const RAIZ_PLUGIN = fileURLToPath(new URL('../../', import.meta.url))

function falha(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e))
// Erro de config vai ao painel como `chave: codigo` (o painel traduz); erro de SO segue cru.
const textoConfig = (e: unknown) => (e instanceof ErroConfig ? e.erros.map((x) => `${x.chave}: ${x.codigo}`).join('; ') : mensagem(e))

const observadores: FSWatcher[] = []
const inscricoes: { dispose(): void }[] = []
let adiado: ReturnType<typeof setTimeout> | undefined
let vigia: ReturnType<typeof criarCiclo> | undefined

export default function activate(orca: OrcaWorkerApi): void {
  const home = homedir()
  const p = paths(home)
  const cli = criarOrcaCli()
  const win = process.platform === 'win32'
  const lancador = join(p.bin, win ? 'agent-pool.cmd' : 'agent-pool')
  let ambiente: Ambiente = { ...AMBIENTE_VAZIO, medidas: medidasGravadas(p) }

  const lerConfig = (): Config => {
    try {
      return carregar(p)
    } catch (e) {
      throw falha('config_recusada', textoConfig(e))
    }
  }
  // Config ilegível não derruba o painel: mostra o padrão e um alerta; gravar continua recusado por lerConfig.
  const estado = () => {
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

  // --- instaladores (ativação e botões do painel) ---
  const removidos = async (): Promise<string[]> => {
    const v = await orca.storage.get(CHAVE_REMOVIDOS)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }
  // Só pasta de conta que já existe: um erro de digitação em `config` não cria pasta nova.
  const existentes = (ps: Pastas): Pastas =>
    Object.fromEntries(Object.entries(ps).map(([a, l]) => [a, l.filter((d) => existsSync(resolve(d.startsWith('~') ? join(home, d.slice(1)) : d)))]))
  const pastasDe = (c: Config): Pastas => existentes(pastasDasContas(c))
  // Config ilegível: só a pasta padrão de cada agente.
  const pastasAtuais = (): Pastas => {
    try {
      return pastasDe(carregar(p))
    } catch {
      return {}
    }
  }
  // Remoção alcança também a conta desativada ou apagada que ainda tem o hook; config ilegível recusa em vez de remover pela metade.
  const pastasParaRemover = (): Pastas => pastasDe(lerConfig())
  // Conta apagada: hook e link da skill saem da pasta dela antes de a conta sair da config (pasta ainda usada por outra conta fica).
  const removerRastroDasContas = (valores: Record<string, string>) => {
    const nomes = Object.entries(valores).filter(([k, v]) => /^conta\..+\.remover$/.test(k) && v.trim() === '1').map(([k]) => k.split('.')[1])
    if (!nomes.length) return
    const c = lerConfig()
    const depois = aplicar(c, valores) // recusa antes de mexer em disco
    const fica = new Set(Object.values(pastasDasContas(depois)).flat())
    const saem = Object.fromEntries(Object.entries(pastasDasContas({ ...c, pool: { ...c.pool, contas: c.pool.contas.filter((ct) => nomes.includes(ct.nome)) } })).map(([a, l]) => [a, (l ?? []).filter((d) => !fica.has(d))])) as Pastas
    const pastas = existentes(saem)
    const erro = removerHooks(home, AGENTES_HOOK.filter((a) => pastas[a]?.length), pastas, true).find((x) => x.estado === 'erro')
    if (erro) throw falha('hooks_falhou', `${erro.pasta}: ${erro.erro ?? 'erro'}`)
    removerLinks(home, pastas)
  }
  const agentesDaSkill =(c: Config) => [...new Set(c.pool.contas.map((ct) => ct.agente))]
  const gravarLancador = () => instalarLancador(p.bin, basename(process.execPath).toLowerCase().startsWith('node') ? null : process.execPath, join(RAIZ_PLUGIN, 'src', 'cli', 'main.ts') /* o Node 24 do Orca roda TypeScript direto; o plugin do catálogo não traz dist/ */, process.platform)
  const instalarSkillAgora = (c: Config, forcar = false) => {
    const r = instalarSkill(join(RAIZ_PLUGIN, 'skill', 'agent-pool'), home, agentesDaSkill(c), { versao, forcar, pastas: pastasDe(c) })
    for (const a of r.avisos) orca.log(`skill: ${a}`)
    if (r.copia === 'erro' || r.copia === 'sem_origem') throw new Error(r.copia === 'sem_origem' ? 'skill_sem_origem' : r.avisos.join('; '))
  }
  const instalarHooksAgora = async (c: Config, agentes: AgenteHook[]) => {
    const r = instalarHooks(home, agentes, lancador, pastasDe(c))
    for (const x of r) if (x.estado === 'erro') orca.log(`hooks ${x.agente} (${x.pasta}): ${x.erro}`)
    if (agentes.length) await orca.storage.set(CHAVE_REMOVIDOS, (await removidos()).filter((a) => !agentes.includes(a as AgenteHook)))
    if (r.some((x) => x.estado === 'erro')) throw new Error(r.filter((x) => x.estado === 'erro').map((x) => `${x.agente} (${x.pasta}): ${x.erro}`).join('; '))
  }

  // Respeita a marca de removido: só reinstala o que o usuário não tirou de propósito.
  const instalarPendentes = async () => {
    const c = lerConfig()
    const ja = await removidos()
    await instalarHooksAgora(c, agentesComHook(c).filter((a) => !ja.includes(a)))
  }

  // Um item por agente: a pior situação entre a pasta padrão e as das contas (erro > ausente > instalado).
  const listaHooks = (): EstadoHookAgente[] => {
    const ordem = { instalado: 0, ausente: 1, erro: 2 } as const
    const por = new Map<string, EstadoHookAgente>()
    for (const h of estadoHooks(home, pastasAtuais())) {
      const atual = por.get(h.agente)
      if (!atual || ordem[h.estado] > ordem[atual.estado]) por.set(h.agente, { agente: h.agente, estado: h.estado, ...(h.erro && { detalhe: `${h.pasta}: ${h.erro}` }) })
    }
    return [...por.values()]
  }

  // Cópia síncrona do que está em storage, atualizada antes de cada leitura de requisitos.
  let marcadosRemovidos: string[] = []
  const requisitos = criarRequisitos({
    orca: async (args) => {
      const r = await cli.run(args)
      if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || `orca_saiu:${r.code}`)
      return r.stdout
    },
    skill: () => ({ estado: estadoSkill(join(RAIZ_PLUGIN, 'skill', 'agent-pool'), home, versao) }),
    lancador: () => existsSync(lancador),
    hooks: () => {
      let c: Config
      try {
        c = carregar(p)
      } catch {
        return []
      }
      const alvo = agentesComHook(c)
      const marcados = marcadosRemovidos
      return listaHooks().filter((h) => alvo.includes(h.agente as AgenteHook)).map((h) => ({ ...h, removido: marcados.includes(h.agente) }))
    },
    instalar: async (id: IdInstalavel) => {
      if (id === 'orchestration') {
        const r = await cli.run(['skills', 'install', '--skill', 'orchestration', '--json'])
        if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || `orca_saiu:${r.code}`)
      } else if (id === 'lancador') gravarLancador()
      else if (id === 'skill') instalarSkillAgora(lerConfig())
      else await instalarPendentes()
    }
  })
  const lerRequisitos = async () => {
    marcadosRemovidos = await removidos()
    return requisitos.ler()
  }

  // --- ciclo: detecção, medição e recuperação de vagas (único lugar que mede) ---
  const atualizar = async () => {
    let c: Config
    try {
      c = carregar(p)
    } catch {
      return // config ilegível: não mede nem sobrescreve
    }
    const detectadas = await detectar(cli, process.env.PATH ?? process.env.Path ?? '')
    // Relê sob a trava: uma gravação do painel durante a detecção não é desfeita.
    let novo = sincronizarDetectadas(c, detectadas)
    if (JSON.stringify(novo) !== JSON.stringify(c)) novo = atualizarConfig(p, (atual) => sincronizarDetectadas(atual, detectadas), () => importarLegado(home))
    const medidas = await medirTodas(novo, p, cli, { home, fetch, agora: Date.now() })
    await recuperar(p, novo, encerradoNoOrca(cli))
    const ramGb = await ramLivreGb(cli)
    const v = await cli.run(['--version'])
    ambiente = { medidas, detectadas, ramGb, orca: { rodando: ramGb !== null, versao: v.code === 0 ? (/\d+\.\d+\.\d+\S*/.exec(v.stdout)?.[0] ?? null) : null } }
  }
  vigia = criarCiclo({ coletar: atualizar, avisar, erro: orca.log })

  // --- handlers ---
  orca.panels.handle('estado.ler', () => estado())
  orca.panels.handle('config.gravar', async ({ valores }) => {
    const pares = Object.entries(valores ?? {})
    if (pares.length === 0 || pares.some(([k, v]) => typeof k !== 'string' || typeof v !== 'string')) throw falha('config_vazia', '')
    const alvo = (c: Config) => JSON.stringify([pastasDe(c), agentesComHook(c)])
    const antes = alvo(lerConfig())
    try {
      removerRastroDasContas(valores)
      atualizarConfig(p, (c) => aplicar(c, valores), () => importarLegado(home))
    } catch (e) {
      throw e instanceof ErroConfig ? falha('config_recusada', textoConfig(e)) : e
    }
    // Conta nova, apagada ou com outra pasta: hook e skill acompanham sem esperar a próxima ativação.
    if (alvo(lerConfig()) !== antes) {
      for (const [nome, passo] of [['skill', () => instalarSkillAgora(lerConfig())], ['hooks', instalarPendentes]] as const) await Promise.resolve().then(passo).catch((e) => orca.log(`config, ${nome}: ${mensagem(e)}`))
      requisitos.invalidar()
    }
    return estado()
  })
  orca.panels.handle('requisitos.ler', () => lerRequisitos())
  orca.panels.handle('requisitos.instalar', ({ id }) => requisitos.instalar(id))
  orca.panels.handle('auto.assistir', (_entrada, { signal }) => vigia!.vigiar(signal))

  const agenteHook = (agente: unknown): AgenteHook => {
    if (!AGENTES_HOOK.includes(agente as AgenteHook)) throw falha('agente_invalido', String(agente))
    return agente as AgenteHook
  }
  orca.panels.handle('hooks.estado', () => listaHooks())
  orca.panels.handle('hooks.remover', async ({ agente }) => {
    const a = agenteHook(agente)
    const r = removerHooks(home, [a], pastasParaRemover()).find((x) => x.estado === 'erro')
    if (r) throw falha('hooks_falhou', `${r.pasta}: ${r.erro ?? 'erro'}`)
    await orca.storage.set(CHAVE_REMOVIDOS, [...new Set([...(await removidos()), a])])
    requisitos.invalidar()
    return listaHooks()
  })
  orca.panels.handle('hooks.reinstalar', async ({ agente }) => {
    await instalarHooksAgora(lerConfig(), [agenteHook(agente)]).catch((e) => {
      throw falha('hooks_falhou', mensagem(e))
    })
    requisitos.invalidar()
    return listaHooks()
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
  observa(p.state, (nome) => !nome.startsWith('backup'), true)
  observa(p.raiz, (nome) => nome === 'config.json', false)

  // --- ativação: legado, config, depois lançador, skill e hooks (cada falha só vira log e requisito pendente) ---
  void (async () => {
    try {
      if (!existsSync(p.config)) {
        const legado = importarLegado(home)
        if (legado) atualizarConfig(p, () => legado)
      }
      await atualizar()
      avisar()
    } catch (e) {
      orca.log(`ativação: ${mensagem(e)}`)
    }
    const passos: [string, () => void | Promise<void>][] = [
      ['lançador', gravarLancador],
      ['skill', () => instalarSkillAgora(lerConfig())],
      ['hooks', instalarPendentes]
    ]
    for (const [nome, passo] of passos) {
      try {
        await passo()
      } catch (e) {
        orca.log(`ativação, ${nome}: ${mensagem(e)}`)
      }
    }
    requisitos.invalidar()
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
