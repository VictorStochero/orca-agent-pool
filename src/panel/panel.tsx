// O painel só acessa a máquina pelo contrato do worker em src/protocol.ts.
// Só leitura nas tabelas (Fila e Pool, nativas); toda a edição fica em Configurações, no fim.
import {
  atom,
  Button,
  Card,
  Checkbox,
  Callout,
  Code,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  Input,
  plugin,
  RadioGroup,
  read,
  RelativeTime,
  Row,
  Select,
  set,
  Spinner,
  Stack,
  storage,
  Tab,
  Table,
  Tabs,
  Text,
  update,
  type OrcaNode,
  type PanelContext,
  type TableCell,
  type TableRow
} from 'orca'
import type { Alerta, Conta, DetalheRequisito, Estado, EstadoHookAgente, ItemFila, RequisitoItem, Requisitos, TesteFila } from '../protocol'
import { manterAtualizando } from './atualizacao'
import { t } from './textos'

/** Texto do erro do worker: o `code` estável vira frase do idioma (+ o dado em `message`); sem tradução, vale a mensagem. */
function textoErro(e: unknown): string {
  const x = e as { code?: string; message?: string }
  if (x.code === 'config_recusada') return codigosConfig(x.message ?? '')
  const base = x.code ? t.erros[x.code] : undefined
  return base ? (x.message ? `${base}: ${traduzirCodigos(x.message)}` : base) : traduzirCodigos(x.message ?? String(e))
}

/** Códigos que o worker embute na mensagem (`raiz_invalida`, `orca_saiu:2`…) viram frase do idioma; o resto segue cru. */
function traduzirCodigos(s: string): string {
  return s.replace(/orca_saiu:(\d+)/g, (_, n: string) => t.orcaSaiu(n)).replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (c) => t.codigosTexto[c] ?? c)
}

/** O worker manda erro de config como `chave: codigo; ...`; códigos conhecidos viram frase do idioma, o resto (erro de SO) segue cru. */
function codigosConfig(s: string): string {
  return s.split('; ').map((parte) => {
    const m = /^(.+): (\w+)$/.exec(parte)
    return m && t.codigosConfig[m[2]] ? `${m[1]}: ${t.codigosConfig[m[2]]}` : parte
  }).join('; ')
}

const hooks = atom<EstadoHookAgente[]>([])
const erroHooks = atom(false)

async function lerHooks(): Promise<void> {
  try {
    set(hooks, await plugin.request('hooks.estado'))
    set(erroHooks, false)
  } catch {
    set(erroHooks, true)
  }
}

async function alterarHook(agente: string, acao: 'remover' | 'reinstalar'): Promise<void> {
  set(gravando, `hook:${agente}`)
  try {
    set(hooks, await plugin.request(`hooks.${acao}`, { agente }))
    set(erroHooks, false)
    update(avisos, (p) => ({ ...p, hooks: { tom: 'success' as const, texto: t.salvo } }))
    const r = await lerRequisitos()
    set(requisitos, r)
    if (!r || r.ok) {
      set(estado, await plugin.request('estado.ler'))
      set(erro, null)
    }
  } catch (e) {
    update(avisos, (p) => ({ ...p, hooks: { tom: 'danger' as const, texto: textoErro(e) } }))
  } finally {
    set(gravando, null)
  }
}

type Erro = { code: string; message: string }
type Aviso = { tom: 'success' | 'danger'; texto: string }

const estado = atom<Estado | null>(null)
/** null enquanto não lido ou quando o worker não tem o handler (painel normal). */
const requisitos = atom<Requisitos | null>(null)
const erro = atom<Erro | null>(null)
const carregando = atom(false)
/** Edições pendentes por chave de configuração (ex.: `conta.main.vagas`). */
const edicoes = atom<Record<string, string>>({})
const avisos = atom<Record<string, Aviso>>({})
const gravando = atom<string | null>(null)
/** Conta com o pedido de remoção aguardando confirmação. */
const removendo = atom<string | null>(null)
/** Conta escolhida em Configurações > Pool (null = a primeira). */
const contaEscolhida = atom<string | null>(null)
/** Intervalo da atualização automática: o worker lê esta chave do storage e reprograma sozinho. */
const CHAVE_INTERVALO = 'atualizacao.intervalo_s'
const INTERVALO = { padrao: 60, min: 15, max: 3600 }
const intervalo = atom(INTERVALO.padrao)
/** Linhas abertas de cada tabela (várias ao mesmo tempo; clicar de novo recolhe). */
const abertasTrava = atom<string[]>([])
const abertasConta = atom<string[]>([])

let coletando = false

/** Worker sem o handler `requisitos.ler` (versão antiga): devolve null e o painel segue normal. */
async function lerRequisitos(): Promise<Requisitos | null> {
  try {
    return await plugin.request('requisitos.ler')
  } catch (e) {
    if ((e as { code?: string }).code === 'unknown_method') return null
    throw e
  }
}

type RequisitoInstalavel = Exclude<RequisitoItem['id'], 'orca'>

export async function instalarRequisito(id: RequisitoInstalavel): Promise<void> {
  set(gravando, `req:${id}`)
  try {
    set(requisitos, await plugin.request('requisitos.instalar', { id })) // devolve os requisitos já lidos de novo
    update(avisos, (p) => ({ ...p, requisitos: { tom: 'success' as const, texto: t.salvo } }))
  } catch (e) {
    update(avisos, (p) => ({ ...p, requisitos: { tom: 'danger' as const, texto: textoErro(e) } }))
  } finally {
    set(gravando, null)
  }
  await atualizar()
}

/** Com uma coleta em andamento, a chamada é descartada (set() é em lote: o átomo `carregando` não serve de guarda). */
export async function atualizar(): Promise<void> {
  if (coletando) return
  coletando = true
  set(carregando, true)
  try {
    const r = await lerRequisitos()
    set(requisitos, r)
    await lerHooks()
    if (r && !r.ok) return set(erro, null) // faltou requisito: só a seção Requisitos, sem coletar o resto
    set(estado, await plugin.request('estado.ler'))
    set(erro, null)
  } catch (e) {
    const x = e as { code?: string; message?: string }
    set(erro, { code: x.code ?? 'erro', message: x.message ?? String(e) })
  } finally {
    coletando = false
    set(carregando, false)
  }
}

function posicaoPapel(p: string): number {
  const i = t.pool.ordemPapeis.indexOf(p)
  return i < 0 ? t.pool.ordemPapeis.length : i
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('estado.mudou', () => void atualizar()))
  void storage.get(CHAVE_INTERVALO).then((v) => typeof v === 'number' && set(intervalo, v))
  void manterAtualizando(ctx.signal)
  void atualizar()
}

export async function salvarIntervalo(): Promise<void> {
  const aviso = (a: Aviso) => update(avisos, (p) => ({ ...p, painel: a }))
  const bruto = (read(edicoes)['painel.intervalo'] ?? String(read(intervalo))).trim()
  const n = Number(bruto)
  if (!/^\d+$/.test(bruto) || n < INTERVALO.min || n > INTERVALO.max) {
    return aviso({ tom: 'danger', texto: t.painel.invalido(INTERVALO.min, INTERVALO.max) })
  }
  try {
    await storage.set(CHAVE_INTERVALO, n)
    set(intervalo, n)
    update(edicoes, (p) => Object.fromEntries(Object.entries(p).filter(([c]) => c !== 'painel.intervalo')))
    aviso({ tom: 'success', texto: t.salvo })
  } catch (e) {
    aviso({ tom: 'danger', texto: (e as { message?: string }).message ?? String(e) })
  }
}

/** Grava as edições das `chaves` da seção (mais os `extras`); a recusa do validador volta como mensagem da seção. */
export async function salvar(secao: string, chaves: string[], extras: Record<string, string> = {}): Promise<boolean> {
  const todas = read(edicoes)
  const valores: Record<string, string> = { ...extras }
  for (const c of chaves) if (c in todas) valores[c] = todas[c]
  const aviso = (a: Aviso) => update(avisos, (p) => ({ ...p, [secao]: a }))
  if (Object.keys(valores).length === 0) {
    aviso({ tom: 'success', texto: t.nadaAlterado })
    return false
  }
  set(gravando, secao)
  try {
    set(estado, await plugin.request('config.gravar', { valores }))
    update(edicoes, (p) => Object.fromEntries(Object.entries(p).filter(([c]) => !(c in valores))))
    aviso({ tom: 'success', texto: t.salvo })
    return true
  } catch (e) {
    aviso({ tom: 'danger', texto: textoErro(e) })
    return false
  } finally {
    set(gravando, null)
  }
}

const mudar = (chave: string, valor: string) => update(edicoes, (p) => ({ ...p, [chave]: valor }))

function Mensagem({ secao }: { secao: string }) {
  const a = read(avisos)[secao]
  return a ? <Text tone={a.tom === 'danger' ? 'danger' : 'success'}>{a.texto}</Text> : null
}

function Salvar({ secao, chaves }: { secao: string; chaves: string[] }) {
  const ocupado = read(gravando) !== null
  return (
    <Row gap="sm" align="center">
      <Button size="sm" icon="check" disabled={ocupado} onPress={() => void salvar(secao, chaves)}>
        {t.salvar}
      </Button>
      {read(gravando) === secao ? (
        <Text muted size="xs">
          {t.gravando}
        </Text>
      ) : null}
    </Row>
  )
}

/** Ícone de dica: no Orca 1.4.246 o `label` é o nome acessível e o tooltip (a prop `tooltip` só existe desde a 1.4.247). */
function Dica({ texto }: { texto: string }) {
  return <IconButton icon="info" label={texto} size="xs" variant="ghost" />
}

/** Campo com o ícone de dica ao lado: o mesmo padrão do modo da fila. */
function ComDica({ texto, children }: { texto: string; children: OrcaNode }) {
  return (
    <Row gap="xs" align="end">
      {children}
      <Dica texto={texto} />
    </Row>
  )
}

type Linha = { key: string; cells: Record<string, TableCell>; detalhes: [string, string | number][] }
type Coluna = { key: string; label: string; align?: 'start' | 'center' | 'end'; width?: 'auto' | 'xs' | 'sm' | 'md' | 'lg'; minWidth?: 'auto' | 'xs' | 'sm' | 'md' }

/**
 * Table nativa que expande a linha: a selecionada ganha, logo abaixo, linhas de detalhe (desabilitadas) com o rótulo na
 * primeira coluna e o valor na segunda. Cada clique alterna a linha (várias abertas; clicar de novo recolhe). Só leitura.
 */
function TabelaExpansivel(props: {
  label: string
  colunas: Coluna[]
  linhas: Linha[]
  abertas: string[]
  onAbrir: (keys: string[]) => void
}) {
  const [c0, c1] = props.colunas
  const rows: TableRow[] = props.linhas.flatMap((l) => [
    { key: l.key, cells: l.cells } as TableRow,
    ...(props.abertas.includes(l.key)
      ? l.detalhes.map(([rotulo, valor], i) => ({ key: `${l.key}#${i}`, disabled: true, cells: { [c0.key]: rotulo, [c1.key]: valor } }) as TableRow)
      : [])
  ])
  return (
    <Table
      label={props.label}
      columns={props.colunas}
      rows={rows}
      // Seleção sempre vazia: todo clique chega como evento e alterna a linha (o clique comum do Orca substitui a seleção e não recolhe).
      selectionMode="single"
      selected={[]}
      onSelectionChange={({ keys }) => {
        const k = keys.find((x) => !x.includes('#'))
        if (k) props.onAbrir(props.abertas.includes(k) ? props.abertas.filter((x) => x !== k) : [...props.abertas, k])
      }}
    />
  )
}

const ITENS_FILA: ItemFila[] = ['modo', 'vagas', 'vagas_projeto', 'teto', 'processos']

function CampoModo({ e }: { e: Estado }) {
  const v = e.fila.config.modo
  const valor = read(edicoes)['fila.modo'] ?? String(v)
  return (
    <Stack gap="xs">
      <Text weight="medium" size="sm">
        {t.fila.campos.modo}
      </Text>
      {(['global', 'banco', 'projeto'] as const).map((m) => (
        <Row key={m} gap="xs" align="center">
          {/* Um RadioGroup de uma opção por linha (RadioOption não tem ícone): o valor marcado é o do estado, então só uma fica selecionada. */}
          <RadioGroup
            label={`${t.fila.campos.modo}: ${t.fila.modos[m]}`}
            labelHidden
            value={valor === m ? m : undefined}
            options={[{ value: m, label: t.fila.modos[m] }]}
            onChange={(x) => mudar('fila.modo', x)}
          />
          <Dica texto={t.fila.dicas[m]} />
        </Row>
      ))}
    </Stack>
  )
}

function CampoFila({ item, e }: { item: Exclude<ItemFila, 'modo'>; e: Estado }) {
  const v = e.fila.config[item]
  const chave = `fila.${item}`
  const dica = item === 'vagas' || item === 'vagas_projeto' || item === 'teto' ? t.fila.dicas[item] : null
  return (
    <Row gap="xs" align="end">
      <Input label={t.fila.campos[item]} value={read(edicoes)[chave] ?? String(v)} onChange={(x) => mudar(chave, x)} />
      {dica ? <Dica texto={dica} /> : null}
    </Row>
  )
}

/** Rótulo da coluna Fila: depende do modo; o detalhe do recurso fica na linha expandida. */
function rotuloFila(modo: Estado['fila']['modo'], x: TesteFila): string {
  if (modo === 'global') return t.fila.filaGlobal
  const r = x.recurso ?? ''
  if (modo === 'projeto') return t.fila.filaProjeto(r.replace(/^projeto\s+/, '') || x.projeto || '-')
  if (r.startsWith('container')) return t.fila.filaContainer
  if (r === 'geral') return t.fila.filaGeral
  const banco = /^[a-z]+ (\S+:\d+(?:\/\S*)?)$/.exec(r) // `<motor> <host>:<porta>[/<banco>]`: mysql, postgres, mongodb, redis
  return banco ? t.fila.filaBanco(banco[1]) : r || '-'
}

function SecaoFila({ e }: { e: Estado }) {
  const { fila } = e
  const testes = fila.testes
  const execucao = testes.filter((x) => x.estado === 'execucao').length
  const aguardando = testes.filter((x) => x.estado === 'aguardando').length
  const linhas: Linha[] = testes.map((x, i) => ({
    key: x.pid === null ? `i${i}` : `p${x.pid}`,
    cells: {
      projeto: x.projeto ?? '-',
      fila: rotuloFila(fila.modo, x),
      estado: t.fila.estados[x.estado] ?? x.estado,
      ha: x.desde_ts ? { type: 'relative', at: x.desde_ts, format: 'duration' } : '-'
    },
    detalhes: [
      ...(x.estado === 'parado' ? ([[t.fila.situacao, t.fila.dicaParado]] as [string, string][]) : []),
      [t.fila.ondeRoda, x.recurso ?? '-'],
      [t.fila.comando, x.comando ?? '-'],
      [t.fila.pid, x.pid ?? '-'],
      [t.fila.worktree, x.worktree ?? '-']
    ]
  }))
  return (
    <Card title={t.fila.titulo} description={t.fila.resumo(execucao, aguardando, fila.teto, t.fila.modos[fila.modo] ?? fila.modo)}>
      <ComDica texto={t.fila.explica}>
        <Text muted size="xs">
          {t.fila.comoFunciona}
        </Text>
      </ComDica>
      {testes.length === 0 ? (
        <Text muted>{t.fila.semTestes}</Text>
      ) : (
        <TabelaExpansivel
          label={t.fila.tabela}
          colunas={[
            { key: 'projeto', label: t.fila.colProjeto, width: 'auto', minWidth: 'xs' },
            { key: 'fila', label: t.fila.colFila, width: 'auto', minWidth: 'xs' },
            { key: 'estado', label: t.fila.colEstado, width: 'auto', minWidth: 'xs' },
            { key: 'ha', label: t.fila.colHa, width: 'xs' }
          ]}
          linhas={linhas}
          abertas={read(abertasTrava)}
          onAbrir={(k) => set(abertasTrava, k)}
        />
      )}
    </Card>
  )
}

const percentual = (v: number | null, alerta: boolean) => t.pool.percentual(v, alerta)
/** Conta ativa que precisa de ação: o valor da cota (se houver) é velho e não aparece. */
const comProblema = (c: Conta) => c.ativo && (c.cota?.estado === 'sem_login' || c.cota?.estado === 'erro')

function textoAlerta(a: Alerta): string {
  const p = a.params ?? {}
  switch (a.codigo) {
    case 'config_ilegivel':
      return t.alertas.config_ilegivel(codigosConfig(p.detalhe ?? ''))
    case 'orca_indisponivel':
      return t.alertas.orca_indisponivel
    case 'sem_login':
      return t.alertas.sem_login(p.conta ?? '')
    case 'erro_medida':
      return t.alertas.erro_medida(p.conta ?? '', p.detalhe)
    case 'teste_parado':
      return t.alertas.teste_parado(p.pid ?? null, p.onde ?? '–')
  }
}

function Atencao({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) return null
  return (
    <Callout tone={alertas.some((a) => a.nivel === 'erro') ? 'danger' : 'warning'} title={t.atencao}>
      <Stack gap="xs">
        {alertas.map((a, i) => (
          <Stack key={`${i}-${a.codigo}`} gap="xs">
            <Text>{textoAlerta(a)}</Text>
            {a.acao ? <Code block>{a.acao}</Code> : null}
          </Stack>
        ))}
      </Stack>
    </Callout>
  )
}

function SecaoPool({ e }: { e: Estado }) {
  const { pool } = e
  const linhas: Linha[] = pool.contas.map((c) => ({
    key: c.nome,
    cells: {
      conta: c.ativo ? c.nome : `${c.nome} (${t.pool.naoUtilizada})`,
      vagas: t.pool.vagasDaConta(c.usadas, c.vagas),
      h5: comProblema(c) ? `⚠ ${t.pool.semLeitura}` : percentual(c.cota?.curta ?? null, c.cota?.alerta_curta ?? false),
      semanal: comProblema(c) ? `⚠ ${t.pool.semLeitura}` : percentual(c.cota?.longa ?? null, c.cota?.alerta_longa ?? false)
    },
    detalhes: [
      ...(comProblema(c) && c.cota ? ([[t.pool.problema, c.cota.estado === 'sem_login' ? t.pool.semLogin : t.pool.erroMedida(c.cota.erro)]] as [string, string][]) : []),
      ...(comProblema(c) && c.cota?.acao ? ([[t.pool.acao, c.cota.acao]] as [string, string][]) : []),
      ...(c.ativo ? [] : ([[t.pool.situacao, t.pool.naoUtilizadaDetalhe]] as [string, string][])),
      ...(c.rotulo ? ([[t.pool.rotulo, c.rotulo]] as [string, string][]) : []),
      [t.pool.agente, c.agente ?? '-'],
      [t.pool.peso, c.peso],
      [t.pool.papeis, c.papeis.map((p) => t.pool.nomesPapel[p] ?? p).join(', ') || '-'],
      [t.pool.janelas, c.cota && (c.cota.estado === 'ok' || c.cota.estado === 'antiga') ? t.pool.janelasValor(c.cota.curta, c.cota.longa) : t.pool.semMedida],
      ...(c.cota && (c.cota.estado === 'ok' || c.cota.estado === 'antiga') ? c.cota.limites.map((l): [string, string] => [l.nome, t.pool.limiteValor(l.curta, l.longa)]) : []),
      [t.pool.medidaHa, c.cota?.medida_ha_min != null ? t.pool.minutos(c.cota.medida_ha_min) : '-'],
      ...(c.cota?.estado === 'antiga' && c.cota.medida_ha_min != null ? ([[t.pool.aviso, t.pool.medidaAntiga(c.cota.medida_ha_min)]] as [string, string][]) : []),
      [t.pool.vagasEmUso, c.ocupantes.map((o) => o.dispatch ?? '?').join(', ') || t.pool.nenhuma]
    ]
  }))
  return (
    <Card title={t.pool.titulo} description={t.pool.resumo(pool.maquina.usadas, pool.maquina.teto, pool.ram_min, pool.escolha)}>
      {pool.contas.length === 0 ? (
        <Text muted>{t.pool.semContas}</Text>
      ) : (
        <TabelaExpansivel
          label={t.pool.tabela}
          colunas={[
            { key: 'conta', label: t.pool.colConta, width: 'md' },
            { key: 'vagas', label: t.pool.colVagas },
            { key: 'h5', label: t.pool.col5h, align: 'end', width: 'xs' },
            { key: 'semanal', label: t.pool.colSemanal, align: 'end', width: 'sm', minWidth: 'sm' }
          ]}
          linhas={linhas}
          abertas={read(abertasConta)}
          onAbrir={(k) => set(abertasConta, k)}
        />
      )}
    </Card>
  )
}

/** Sobe ou desce uma conta: grava a lista completa das contas na ordem nova. */
function mover(contas: Conta[], nome: string, delta: -1 | 1): Promise<boolean> {
  const nomes = contas.map((c) => c.nome)
  const i = nomes.indexOf(nome)
  const j = i + delta
  if (i < 0 || j < 0 || j >= nomes.length) return Promise.resolve(false)
  ;[nomes[i], nomes[j]] = [nomes[j], nomes[i]]
  return salvar(`conta.${nome}`, [], { 'pool.ordem': nomes.join(',') })
}

/** Edição da conta escolhida: vagas, peso, config, papéis, ordem, "Não utilizar" e remover. */
function EdicaoConta({ c, e }: { c: Conta; e: Estado }) {
  const secao = `conta.${c.nome}`
  const chaveAtivo = `conta.${c.nome}.ativo`
  const chaveVagas = `conta.${c.nome}.vagas`
  const chavePeso = `conta.${c.nome}.peso`
  const chavePapeis = `conta.${c.nome}.papeis`
  const chaveConfig = `conta.${c.nome}.config`
  const chaveComando = `conta.${c.nome}.comando`
  const ed = read(edicoes)
  const papeis = (ed[chavePapeis] ?? c.papeis.join(',')).split(',').filter(Boolean)
  const alterna = (p: string, marcado: boolean) =>
    mudar(chavePapeis, e.pool.papeis_validos.filter((x) => (x === p ? marcado : papeis.includes(x))).join(','))
  const noPool = e.pool.contas.map((x) => x.nome)
  const naoUtilizar = (ed[chaveAtivo] ?? (c.ativo ? 'sim' : 'nao')) === 'nao'
  const ocupado = read(gravando) !== null
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center">
        <Text size="sm">{t.pool.ordemNaTabela}</Text>
        <IconButton icon="collapse" label={t.pool.subir} size="xs" variant="ghost" disabled={ocupado || noPool[0] === c.nome} onPress={() => void mover(e.pool.contas, c.nome, -1)} />
        <IconButton icon="expand" label={t.pool.descer} size="xs" variant="ghost" disabled={ocupado || noPool[noPool.length - 1] === c.nome} onPress={() => void mover(e.pool.contas, c.nome, 1)} />
      </Row>
      <ComDica texto={t.pool.dicas.vagas}>
        <Input label={t.pool.vagas} value={ed[chaveVagas] ?? String(c.vagas)} onChange={(x) => mudar(chaveVagas, x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.peso}>
        <Input label={t.pool.pesoDaConta} value={ed[chavePeso] ?? String(c.peso)} onChange={(x) => mudar(chavePeso, x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.config}>
        <Input label={t.pool.config} value={ed[chaveConfig] ?? c.config ?? ''} onChange={(x) => mudar(chaveConfig, x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.novoComando}>
        <Input label={t.pool.comandoDaConta} value={ed[chaveComando] ?? c.comando ?? ''} onChange={(x) => mudar(chaveComando, x)} />
      </ComDica>
      <Row gap="xs" align="center">
        <Checkbox label={t.pool.naoUtilizar} checked={naoUtilizar} onChange={(m) => mudar(chaveAtivo, m ? 'nao' : 'sim')} />
        <Dica texto={t.pool.dicas.naoUtilizar} />
      </Row>
      <Stack gap="xs">
        <Text weight="medium" size="sm">
          {t.pool.papeis}
        </Text>
        {[...e.pool.papeis_validos].sort((a, b) => posicaoPapel(a) - posicaoPapel(b)).map((p) => (
          <Row key={p} gap="xs" align="center">
            <Checkbox label={t.pool.nomesPapel[p] ?? p} checked={papeis.includes(p)} onChange={(m) => alterna(p, m)} />
            <Dica texto={t.pool.dicasPapel[p] ?? p} />
          </Row>
        ))}
      </Stack>
      <Mensagem secao={secao} />
      <Salvar secao={secao} chaves={[chaveVagas, chavePeso, chavePapeis, chaveConfig, chaveComando, chaveAtivo]} />
      {read(removendo) === c.nome ? (
        <Stack gap="xs">
          <Text tone="warning">{t.pool.confirmarRemocao(c.nome)}</Text>
          <Row gap="sm">
            <Button
              size="sm"
              tone="danger"
              icon="delete"
              onPress={() => {
                set(removendo, null)
                void salvar(secao, [], { [`conta.${c.nome}.remover`]: '1' }).then((ok) => {
                  if (ok) set(contaEscolhida, null)
                })
              }}
            >
              {t.pool.confirmar}
            </Button>
            <Button size="sm" variant="ghost" onPress={() => set(removendo, null)}>
              {t.pool.cancelar}
            </Button>
          </Row>
        </Stack>
      ) : c.origem === 'manual' ? (
        <Button size="sm" variant="outline" tone="danger" icon="delete" onPress={() => set(removendo, c.nome)}>
          {t.pool.remover}
        </Button>
      ) : null}
    </Stack>
  )
}

function NovaConta() {
  const ed = read(edicoes)
  const nome = ed['nova.nome'] ?? ''
  const comando = (ed['nova.comando'] ?? '').trim()
  const config = (ed['nova.config'] ?? '').trim()
  const criar = async () => {
    const extras: Record<string, string> = { [`conta.${nome}.adicionar`]: 'auto' }
    if (config) extras[`conta.${nome}.config`] = config
    if (comando) extras[`conta.${nome}.comando`] = comando
    if (await salvar('nova', [], extras)) update(edicoes, (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('nova.'))))
  }
  return (
    <Stack gap="sm">
      <Text weight="medium">{t.pool.nova}</Text>
      <Input label={t.pool.novaNome} value={nome} onChange={(x) => mudar('nova.nome', x)} />
      <ComDica texto={t.pool.dicas.novoComando}>
        <Input label={t.pool.comandoCli} value={ed['nova.comando'] ?? ''} onChange={(x) => mudar('nova.comando', x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.novoConfig}>
        <Input label={t.pool.novaConfig} value={ed['nova.config'] ?? ''} onChange={(x) => mudar('nova.config', x)} />
      </ComDica>
      <Mensagem secao="nova" />
      <Button size="sm" icon="add" disabled={read(gravando) !== null || !nome.trim() || (!comando && !config)} onPress={() => void criar()}>
        {t.pool.novaCriar}
      </Button>
    </Stack>
  )
}

function ConfigFila({ e }: { e: Estado }) {
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        {t.configuracoes.linhas.fila}
      </Text>
      <Text muted size="xs">
        {t.fila.configurarDescricao}
      </Text>
      <CampoModo e={e} />
      {(['vagas', 'vagas_projeto', 'teto', 'processos'] as const).map((i) => (
        <CampoFila key={i} item={i} e={e} />
      ))}
      <Mensagem secao="fila" />
      <Salvar secao="fila" chaves={ITENS_FILA.map((i) => `fila.${i}`)} />
    </Stack>
  )
}

function ConfigPool({ e }: { e: Estado }) {
  const { pool } = e
  const ed = read(edicoes)
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        {t.configuracoes.linhas.pool}
      </Text>
      <ComDica texto={t.pool.dicas.teto}>
        <Input label={t.pool.teto} value={ed['pool.teto'] ?? String(pool.teto)} onChange={(x) => mudar('pool.teto', x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.ramMin}>
        <Input label={t.pool.ramMin} value={ed['pool.ram_min'] ?? String(pool.ram_min)} onChange={(x) => mudar('pool.ram_min', x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.escolha}>
        <Select
          label={t.pool.escolha}
          value={ed['pool.escolha'] ?? pool.escolha}
          options={[{ value: 'ritmo', label: t.pool.escolhaOpcoes.ritmo }, { value: 'ordem', label: t.pool.escolhaOpcoes.ordem }]}
          onChange={(x) => mudar('pool.escolha', x)}
        />
      </ComDica>
      <Mensagem secao="pool" />
      <Salvar secao="pool" chaves={['pool.teto', 'pool.ram_min', 'pool.escolha']} />
    </Stack>
  )
}

function ConfigContas({ e }: { e: Estado }) {
  const { pool } = e
  const escolhida = read(contaEscolhida)
  const conta = pool.contas.find((c) => c.nome === escolhida) ?? pool.contas[0]
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        {t.configuracoes.linhas.contas}
      </Text>
      <Tabs label={t.configuracoes.contasAbas.assuntos} defaultValue="configurar">
        <Tab value="configurar" label={t.configuracoes.contasAbas.configurar}>
          {conta ? (
            <Stack gap="sm">
              <Select
                label={t.pool.escolherConta}
                value={conta.nome}
                options={pool.contas.map((c) => ({ value: c.nome, label: c.ativo ? c.nome : `${c.nome} (${t.pool.naoUtilizada})` }))}
                onChange={(x) => {
                  set(removendo, null)
                  set(contaEscolhida, x)
                }}
              />
              <EdicaoConta key={conta.nome} c={conta} e={e} />
            </Stack>
          ) : (
            <Text muted>{t.pool.semContas}</Text>
          )}
        </Tab>
        <Tab value="cadastrar" label={t.configuracoes.contasAbas.cadastrar}>
          <NovaConta />
        </Tab>
      </Tabs>
    </Stack>
  )
}

function ConfigImposicao() {
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        {t.imposicao.descricao}
      </Text>
      <CorpoImposicao />
    </Stack>
  )
}

function ConfigPainel() {
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        {t.configuracoes.linhas.painel}
      </Text>
      <ComDica texto={t.painel.dica}>
        <Input label={t.painel.intervalo} value={read(edicoes)['painel.intervalo'] ?? String(read(intervalo))} onChange={(x) => mudar('painel.intervalo', x)} />
      </ComDica>
      <Mensagem secao="painel" />
      <Button size="sm" icon="check" onPress={() => void salvarIntervalo()}>
        {t.salvar}
      </Button>
    </Stack>
  )
}

function SecaoConfiguracoes({ e }: { e: Estado }) {
  const abas = [
    { id: 'fila', corpo: <ConfigFila e={e} /> },
    { id: 'pool', corpo: <ConfigPool e={e} /> },
    { id: 'contas', corpo: <ConfigContas e={e} /> },
    { id: 'imposicao', corpo: <ConfigImposicao /> },
    { id: 'painel', corpo: <ConfigPainel /> }
  ] as const
  return (
    <Card>
      <Collapsible title={t.configuracoes.titulo} description={t.configuracoes.descricao}>
        <Tabs label={t.configuracoes.assuntos} defaultValue="fila">
          {abas.map((a) => (
            <Tab key={a.id} value={a.id} label={t.configuracoes.abas[a.id]}>
              {a.corpo}
            </Tab>
          ))}
        </Tabs>
      </Collapsible>
    </Card>
  )
}

function textoDetalhe(d: DetalheRequisito): string {
  const x = t.requisitos.detalhe
  switch (d.codigo) {
    case 'nao_verificado':
    case 'versao':
    case 'versao_antiga':
      return x[d.codigo](traduzirCodigos(d.valor))
    case 'hooks':
      return d.agentes.map((a) => `${a.agente}: ${a.situacao === 'erro' && a.erro ? traduzirCodigos(a.erro) : x.situacoes[a.situacao]}`).join('; ')
    default:
      return x[d.codigo]
  }
}

function SecaoRequisitos({ r }: { r: Requisitos }) {
  const linhas: TableRow[] = r.itens.map((i) => ({ key: i.id, cells: { requisito: t.requisitos.nomes[i.id], situacao: i.ok ? t.requisitos.ok : t.requisitos.falta } }))
  return (
    <Card title={t.requisitos.titulo} description={t.requisitos.explica}>
      <Table
        label={t.requisitos.tabela}
        columns={[
          { key: 'requisito', label: t.requisitos.colRequisito, width: 'lg' },
          { key: 'situacao', label: t.requisitos.colSituacao, width: 'sm' }
        ]}
        rows={linhas}
      />
      {r.itens
        .filter((i) => !i.ok)
        .map((i) => (
          <Stack key={i.id} gap="xs">
            <Text weight="medium">{t.requisitos.nomes[i.id]}</Text>
            <Text muted size="xs">
              {textoDetalhe(i.detalhe)}
            </Text>
            {i.instalar && i.id !== 'orca' ? (
              <Button size="sm" icon="download" disabled={read(gravando) !== null} onPress={() => { if (i.id !== 'orca') void instalarRequisito(i.id) }}>
                {read(gravando) === `req:${i.id}` ? t.requisitos.instalando : t.requisitos.instalar}
              </Button>
            ) : null}
          </Stack>
        ))}
      <Mensagem secao="requisitos" />
    </Card>
  )
}

function CorpoImposicao() {
  return (
    <Stack gap="sm">
      {read(erroHooks) ? <Text tone="danger">{t.imposicao.indisponivel}</Text> : null}
      {read(hooks).map((h) => (
        <Stack key={h.agente} gap="xs">
          <Text weight="medium">{h.agente}</Text>
          <Text tone={h.estado === 'erro' ? 'danger' : undefined}>{t.imposicao.estados[h.estado]}</Text>
          {h.detalhe ? <Text size="xs">{h.detalhe}</Text> : null}
          <Row gap="sm">
            {h.estado === 'instalado' ? (
              <Button size="sm" tone="danger" disabled={read(gravando) !== null} onPress={() => void alterarHook(h.agente, 'remover')}>
                {t.imposicao.remover}
              </Button>
            ) : null}
            <Button size="sm" disabled={read(gravando) !== null} onPress={() => void alterarHook(h.agente, 'reinstalar')}>
              {t.imposicao.reinstalar}
            </Button>
          </Row>
        </Stack>
      ))}
      <Mensagem secao="hooks" />
    </Stack>
  )
}

/** Sem requisitos o painel não mostra Configurações: a imposição fica solta aqui para poder reinstalar os hooks. */
function SecaoImposicao() {
  return (
    <Card title={t.imposicao.titulo} description={t.imposicao.descricao}>
      <CorpoImposicao />
    </Card>
  )
}

export default function Painel() {
  const e = read(estado)
  const x = read(erro)
  const r = read(requisitos)
  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Heading>{t.titulo}</Heading>
        <Button icon="refresh" size="sm" disabled={read(carregando)} onPress={() => void atualizar()}>
          {t.atualizar}
        </Button>
      </Row>
      {x ? (
        <Stack gap="xs">
          <Text tone="danger" weight="medium">
            {t.coletorFalhou(x.code)}
          </Text>
          <Text tone="danger">{x.message}</Text>
        </Stack>
      ) : null}
      {r && !r.ok ? (
        <Stack gap="md">
          <SecaoRequisitos r={r} />
          <SecaoImposicao />
        </Stack>
      ) : e === null ? (
        x ? (
          <EmptyState title={t.semDados} description={t.coletorNaoRespondeu} icon="warning" />
        ) : (
          <Spinner label={t.carregando} />
        )
      ) : (
        <Stack gap="md">
          <Text muted size="xs">
            {t.atualizadoEm} <RelativeTime at={Date.parse(e.gerado_em)} />
            {` · ${t.dicaLinha}`}
          </Text>
          <Atencao alertas={e.alertas} />
          <Text size="xs" muted>
            {`${t.plugin} ${e.saude.plugin_versao ?? '?'} · ${t.orca} ${e.saude.orca.rodando === null ? t.orcaVerificando : e.saude.orca.rodando ? (e.saude.orca.versao ?? t.orcaRodando) : t.orcaForaDoAr}`}
          </Text>
          <SecaoFila e={e} />
          <SecaoPool e={e} />
          <SecaoConfiguracoes e={e} />
        </Stack>
      )}
    </Stack>
  )
}
