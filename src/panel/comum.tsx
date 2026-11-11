// Componentes usados por mais de uma seção.
import {
  Box,
  type BoxLength,
  Button,
  Code,
  IconButton,
  List,
  ListItem,
  type OrcaNode,
  RelativeTime,
  type RelativeTimeCell,
  Row,
  read,
  Separator,
  Stack,
  type TableCell,
  Text,
  type TextProps,
} from 'orca'
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
/** Cartão das seções: borda, cantos e fundo do tema, com menos espaço interno que o Card nativo (que não aceita padding). */
export function Secao({ titulo, descricao, children }: { titulo?: string; descricao?: string; children?: OrcaNode }) {
  return (
    <Box border radius="lg" background="card" padding="sm" gap="sm">
      {titulo ? (
        <Stack gap="none">
          <Text weight="semibold">{titulo}</Text>
          {descricao ? (
            <Text size="sm" muted>
              {descricao}
            </Text>
          ) : null}
        </Stack>
      ) : null}
      {children}
    </Box>
  )
}

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

/** Detalhe: [rótulo, valor]; o valor pode ser um tempo relativo, que o Orca mantém atualizado. */
export type Detalhe = [string, string | number | RelativeTimeCell]
/** Linha de detalhe condicional: some quando o valor é vazio ou falso. */
export const se = (rotulo: string, valor: string | false | null | undefined): Detalhe[] => (valor ? [[rotulo, valor]] : [])
export type Linha = { key: string; cells: Record<string, TableCell>; detalhes: Detalhe[] }
type Coluna = { key: string; label: string; align?: 'start' | 'center' | 'end' }

/** Fatia da largura que as colunas depois da primeira dividem; a primeira cresce com o que sobra. */
const LARGURA_DEMAIS_COLUNAS = 60
/** Largura do rótulo na linha de detalhe; o valor ocupa o resto e quebra linha. */
const LARGURA_ROTULO = '35%'

function Valor({ v, truncar, ...props }: { v: TableCell | RelativeTimeCell; truncar?: boolean } & TextProps) {
  return (
    <Text {...props} truncate={truncar}>
      {typeof v === 'object' && v !== null ? <RelativeTime at={v.at} format={v.format} /> : String(v ?? '')}
    </Text>
  )
}

/**
 * Tabela própria (List + Box, com o tema do Orca): cabeçalho, uma linha clicável por item e, na aberta, um bloco de duas
 * colunas (rótulo e valor inteiro) na largura toda. Cada clique alterna a linha (várias abertas; clicar de novo recolhe). Só leitura.
 */
export function TabelaExpansivel(props: {
  label: string
  colunas: Coluna[]
  linhas: Linha[]
  abertas: string[]
  onAbrir: (keys: string[]) => void
}) {
  const demais: BoxLength = `${Math.floor(LARGURA_DEMAIS_COLUNAS / Math.max(1, props.colunas.length - 1))}%`
  const celula = (prefixo: string, c: Coluna, i: number, conteudo: OrcaNode) => (
    <Box
      key={`${prefixo}.${c.key}`}
      direction="row"
      justify={c.align === 'end' ? 'end' : 'start'}
      grow={i === 0}
      shrink={i === 0}
      width={i === 0 ? undefined : demais}
    >
      {conteudo}
    </Box>
  )
  const alternar = (k: string) => props.onAbrir(props.abertas.includes(k) ? props.abertas.filter(x => x !== k) : [...props.abertas, k])
  return (
    <List label={props.label}>
      <ListItem key="cabecalho">
        <Box direction="row" gap="xs">
          {props.colunas.map((c, i) =>
            celula(
              'cabecalho',
              c,
              i,
              <Text size="xs" muted weight="medium" truncate>
                {c.label}
              </Text>,
            ),
          )}
        </Box>
      </ListItem>
      {props.linhas.flatMap(l => {
        const aberta = props.abertas.includes(l.key)
        return [
          <ListItem key={l.key} current={aberta} onPress={() => alternar(l.key)}>
            {/* Divisória entre as linhas, como a Table nativa; a List só aceita ListItem como filho. */}
            <Stack gap="xs">
              <Separator />
              <Box direction="row" gap="xs">
                {props.colunas.map((c, i) => celula(l.key, c, i, <Valor v={l.cells[c.key]} truncar />))}
              </Box>
            </Stack>
          </ListItem>,
          ...(aberta
            ? [
                <ListItem key={`${l.key}#detalhes`}>
                  <Box gap="xs">
                    {l.detalhes.map(([rotulo, valor], i) => (
                      <Box key={`${l.key}#${i}`} direction="row" gap="xs">
                        <Box key={`${l.key}#${i}:rotulo`} width={LARGURA_ROTULO} shrink={false}>
                          <Text size="sm" muted>
                            {rotulo}
                          </Text>
                        </Box>
                        <Box key={`${l.key}#${i}:valor`} grow>
                          <Valor v={valor} size="sm" />
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </ListItem>,
              ]
            : []),
        ]
      })}
    </List>
  )
}
