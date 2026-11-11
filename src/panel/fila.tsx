// Seção Fila (só leitura) e os campos de configuração da fila.
import { atom, Checkbox, Input, RadioGroup, Row, read, Stack, set, Text } from 'orca'
import type { Estado, ItemFila, TesteFila } from '../protocol'
import { ComDica, type Detalhe, Dica, type Linha, Mensagem, Salvar, Secao, se, TabelaExpansivel } from './comum'
import { edicoes, mudar } from './estado'
import { t } from './textos'

/** Linhas abertas da tabela (várias ao mesmo tempo; clicar de novo recolhe). */
const abertasTrava = atom<string[]>([])

const ITENS_FILA: ItemFila[] = ['modo', 'vagas', 'vagas_projeto', 'teto', 'processos', 'sem_saida_min', 'limpar_bancos']

/** Rótulo da coluna Fila: vem da fila real da linha (quem começou antes da troca de modo segue na fila antiga); sem ela, do modo atual. */
function rotuloFila(modo: Estado['fila']['modo'], x: TesteFila): string {
  const fila = x.fila ?? (modo === 'global' ? 'global' : modo === 'projeto' ? 'proj-' : null)
  if (fila === 'global') return t.fila.filaGlobal
  if (fila?.startsWith('proj-')) return t.fila.filaProjeto(x.projeto || '-')
  if (fila === '_teto') return t.fila.filaTeto
  const r = x.recurso ?? ''
  if (r.startsWith('container')) return t.fila.filaContainer
  if (r === 'geral') return t.fila.filaGeral
  const banco = /^[a-z]+ (\S+:\d+(?:\/\S*)?)$/.exec(r) // `<motor> <host>:<porta>[/<banco>]`: mysql, postgres, mongodb, redis
  return banco ? t.fila.filaBanco(banco[1]) : r || '-'
}

/** Barra de 10 posições com o total (`▓▓▓▓▓░░░░░ 52% (63/120)`) e, havendo contagem, `· ✓ N passaram · ⨯ M falharam`; pytest traz só a barra. */
function textoProgresso(s: NonNullable<TesteFila['saida']>): string | null {
  const contagem = s.passou == null || s.falhou == null ? null : t.fila.passaramFalharam(s.passou, s.falhou)
  if (s.pct === null) return contagem
  const cheias = Math.min(10, Math.floor(s.pct / 10))
  const total = s.feitos !== null && s.total !== null ? ` (${s.feitos}/${s.total})` : ''
  return `${'▓'.repeat(cheias)}${'░'.repeat(10 - cheias)} ${s.pct}%${total}${contagem ? ` · ${contagem}` : ''}`
}

/** Progresso e última saída do teste em execução; a coluna "Fila" leva o relativo (mesma célula da coluna Há). */
function detalhesSaida(x: TesteFila): Detalhe[] {
  const s = x.saida
  if (x.estado !== 'execucao') return []
  // Sem saída ainda (ts 0 = só o total listado chegou): o teste é acompanhado e só está calado (ex.: migrando o banco).
  if (!s || s.ts === 0) return [...se(t.fila.progresso, s && textoProgresso(s)), [t.fila.ultimaSaida, t.fila.nenhumaAinda]]
  return [
    ...se(t.fila.progresso, textoProgresso(s)),
    [t.fila.ultimaSaida, { type: 'relative', at: s.ts, format: 'duration' }],
    ...se(t.fila.ultimaLinha, s.linha),
    [t.fila.linhasSaida, s.linhas],
  ]
}

export function SecaoFila({ e }: { e: Estado }) {
  const { fila } = e
  const testes = fila.testes
  const execucao = testes.filter(x => x.estado === 'execucao').length
  const aguardando = testes.filter(x => x.estado === 'aguardando').length
  const linhas: Linha[] = testes.map((x, i) => ({
    key: x.pid === null ? `i${i}` : `p${x.pid}`,
    cells: {
      projeto: x.projeto ?? '-',
      fila: rotuloFila(fila.modo, x),
      estado: t.fila.estados[x.estado] ?? x.estado,
      ha: x.desde_ts ? { type: 'relative', at: x.desde_ts, format: 'duration' } : '-',
    },
    detalhes: [
      ...se(t.fila.situacao, x.estado === 'parado' && t.fila.dicaParado),
      ...detalhesSaida(x),
      [t.fila.ondeRoda, x.recurso ?? '-'],
      [t.fila.comando, x.comando ?? '-'],
      [t.fila.pid, x.pid ?? '-'],
      [t.fila.worktree, x.worktree ?? '-'],
    ],
  }))
  return (
    <Secao titulo={t.fila.titulo} descricao={t.fila.resumo(execucao, aguardando, fila.teto, t.fila.modos[fila.modo] ?? fila.modo)}>
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
            { key: 'projeto', label: t.fila.colProjeto, largura: 140 },
            { key: 'fila', label: t.fila.colFila, largura: 130 },
            { key: 'estado', label: t.fila.colEstado, largura: 130 },
            { key: 'ha', label: t.fila.colHa, largura: 70 },
          ]}
          linhas={linhas}
          abertas={read(abertasTrava)}
          onAbrir={k => set(abertasTrava, k)}
        />
      )}
    </Secao>
  )
}

function CampoModo({ e }: { e: Estado }) {
  const v = e.fila.config.modo
  const valor = read(edicoes)['fila.modo'] ?? String(v)
  return (
    <Stack gap="xs">
      <Text weight="medium" size="sm">
        {t.fila.campos.modo}
      </Text>
      {(['global', 'banco', 'projeto'] as const).map(m => (
        <Row key={m} gap="xs" align="center">
          {/* Um RadioGroup de uma opção por linha (RadioOption não tem ícone): o valor marcado é o do estado, então só uma fica selecionada. */}
          <RadioGroup
            label={`${t.fila.campos.modo}: ${t.fila.modos[m]}`}
            labelHidden
            value={valor === m ? m : ''}
            options={[{ value: m, label: t.fila.modos[m] }]}
            onChange={x => mudar('fila.modo', x)}
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
  const dica = t.fila.dicas[item]
  return (
    <Row gap="xs" align="end">
      <Input label={t.fila.campos[item]} value={read(edicoes)[chave] ?? String(v)} onChange={x => mudar(chave, x)} />
      {dica ? <Dica texto={dica} /> : null}
    </Row>
  )
}

/** Campos que valem no modo: por projeto usa só vagas_projeto; global e por banco (testes sem banco) usam vagas. */
export function camposDoModo(modo: string): Exclude<ItemFila, 'modo' | 'limpar_bancos'>[] {
  return [modo === 'projeto' ? 'vagas_projeto' : 'vagas', 'teto', 'processos', 'sem_saida_min']
}

export function ConfigFila({ e }: { e: Estado }) {
  // O modo marcado, mesmo antes de salvar, decide quais campos aparecem.
  const modo = read(edicoes)['fila.modo'] ?? String(e.fila.config.modo)
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        {t.configuracoes.linhas.fila}
      </Text>
      <Text muted size="xs">
        {t.fila.configurarDescricao}
      </Text>
      <CampoModo e={e} />
      {camposDoModo(modo).map(i => (
        <CampoFila key={i} item={i} e={e} />
      ))}
      <Row gap="xs" align="center">
        <Checkbox
          label={t.fila.campos.limpar_bancos}
          checked={(read(edicoes)['fila.limpar_bancos'] ?? String(e.fila.config.limpar_bancos)) === 'sim'}
          onChange={m => mudar('fila.limpar_bancos', m ? 'sim' : 'nao')}
        />
        <Dica texto={t.fila.dicas.limpar_bancos} />
      </Row>
      <Mensagem secao="fila" />
      <Salvar secao="fila" chaves={ITENS_FILA.map(i => `fila.${i}`)} />
    </Stack>
  )
}
