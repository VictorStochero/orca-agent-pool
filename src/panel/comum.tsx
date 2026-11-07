// Componentes usados por mais de uma seção.
import { Button, Code, IconButton, type OrcaNode, Row, read, Stack, Table, type TableCell, type TableRow, Text } from 'orca'
import { avisos, gravando, releituraFalhou, salvar } from './estado'
import { t } from './textos'

export function Mensagem({ secao }: { secao: string }) {
  const a = read(avisos)[secao]
  if (secao === 'requisitos' && read(releituraFalhou) && a?.tom !== 'danger')
    return <Text tone="danger">{t.requisitos.leituraInvalida}</Text>
  return a ? <Text tone={a.tom === 'danger' ? 'danger' : 'success'}>{a.texto}</Text> : null
}

export function Salvar({ secao, chaves }: { secao: string; chaves: string[] }) {
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

/** Ícone de dica: o `label` é o nome acessível e o tooltip. */
export function Dica({ texto }: { texto: string }) {
  return <IconButton icon="info" label={texto} size="xs" variant="ghost" />
}

/** Campo com o ícone de dica ao lado: o mesmo padrão do modo da fila. */
export function ComDica({ texto, children }: { texto: string; children: OrcaNode }) {
  return (
    <Row gap="xs" align="end">
      {children}
      <Dica texto={texto} />
    </Row>
  )
}

/** Lista de arquivos que um clique vai gravar, um por linha. */
export function Arquivos({ titulo, lista }: { titulo: string; lista: readonly string[] }) {
  return (
    <Stack gap="xs">
      <Text size="sm" weight="medium">
        {titulo}
      </Text>
      {lista.map(f => (
        <Code key={f}>{f}</Code>
      ))}
    </Stack>
  )
}

/** Detalhe: [rótulo, valor] nas duas primeiras colunas, ou células por coluna (ex.: limite separado em 5h e Semanal). */
export type Detalhe = [string, string | number] | { celulas: Record<string, TableCell> }
/** Linha de detalhe condicional: some quando o valor é vazio ou falso. */
export const se = (rotulo: string, valor: string | false | null | undefined): Detalhe[] => (valor ? [[rotulo, valor]] : [])
export type Linha = { key: string; cells: Record<string, TableCell>; detalhes: Detalhe[] }
type Coluna = {
  key: string
  label: string
  align?: 'start' | 'center' | 'end'
  width?: 'auto' | 'xs' | 'sm' | 'md' | 'lg'
  minWidth?: 'auto' | 'xs' | 'sm' | 'md'
}

/** O Orca invalida a Table inteira se uma célula de texto passar de 1024 caracteres (maxLabelLength). */
const LIMITE_CELULA = 1024
function caber<T>(v: T): T | string {
  if (typeof v !== 'string' || v.length <= LIMITE_CELULA) return v
  const alto = /[\uD800-\uDBFF]/.test(v[LIMITE_CELULA - 2]) // não deixa metade de um par substituto antes do "…"
  return `${v.slice(0, LIMITE_CELULA - (alto ? 2 : 1))}…`
}

/**
 * Table nativa que expande a linha: a selecionada ganha, logo abaixo, linhas de detalhe (desabilitadas) com o rótulo na
 * primeira coluna e o valor na segunda (ou, no detalhe com células, o valor de cada coluna). Cada clique alterna a linha (várias abertas; clicar de novo recolhe). Só leitura.
 */
export function TabelaExpansivel(props: {
  label: string
  colunas: Coluna[]
  linhas: Linha[]
  abertas: string[]
  onAbrir: (keys: string[]) => void
}) {
  const [c0, c1] = props.colunas
  const rows: TableRow[] = props.linhas.flatMap(l => [
    { key: l.key, cells: Object.fromEntries(Object.entries(l.cells).map(([k, v]) => [k, caber(v)])) } as TableRow,
    ...(props.abertas.includes(l.key)
      ? l.detalhes.map(
          (d, i) =>
            ({
              key: `${l.key}#${i}`,
              disabled: true,
              cells: Array.isArray(d)
                ? { [c0.key]: caber(d[0]), [c1.key]: caber(d[1]) }
                : Object.fromEntries(Object.entries(d.celulas).map(([k, v]) => [k, caber(v)])),
            }) as TableRow,
        )
      : []),
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
        const k = keys.find(x => !x.includes('#'))
        if (k) props.onAbrir(props.abertas.includes(k) ? props.abertas.filter(x => x !== k) : [...props.abertas, k])
      }}
    />
  )
}
