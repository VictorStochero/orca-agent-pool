// Seção Fila (só leitura) e os campos de configuração da fila.
import { atom, Card, Checkbox, Input, RadioGroup, Row, read, Stack, set, Text } from 'orca'
import type { Estado, ItemFila, TesteFila } from '../protocol'
import { ComDica, Dica, type Linha, Mensagem, Salvar, se, TabelaExpansivel } from './comum'
import { edicoes, mudar } from './estado'
import { t } from './textos'

/** Linhas abertas da tabela (várias ao mesmo tempo; clicar de novo recolhe). */
const abertasTrava = atom<string[]>([])

const ITENS_FILA: ItemFila[] = ['modo', 'vagas', 'vagas_projeto', 'teto', 'processos', 'limpar_bancos']

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
      [t.fila.ondeRoda, x.recurso ?? '-'],
      [t.fila.comando, x.comando ?? '-'],
      [t.fila.pid, x.pid ?? '-'],
      [t.fila.worktree, x.worktree ?? '-'],
    ],
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
            { key: 'projeto', label: t.fila.colProjeto, width: 'auto', minWidth: 'md' },
            { key: 'fila', label: t.fila.colFila, width: 'auto' },
            { key: 'estado', label: t.fila.colEstado, width: 'auto' },
            { key: 'ha', label: t.fila.colHa, width: 'auto' },
          ]}
          linhas={linhas}
          abertas={read(abertasTrava)}
          onAbrir={k => set(abertasTrava, k)}
        />
      )}
    </Card>
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

export function ConfigFila({ e }: { e: Estado }) {
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        {t.configuracoes.linhas.fila}
      </Text>
      <Text muted size="xs">
        {t.fila.configurarDescricao}
      </Text>
      <CampoModo e={e} />
      {(['vagas', 'vagas_projeto', 'teto', 'processos'] as const).map(i => (
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
