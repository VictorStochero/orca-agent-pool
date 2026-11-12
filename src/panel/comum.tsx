// Componentes usados por mais de uma seção.
import {
  atom,
  Box,
  Button,
  Code,
  env,
  IconButton,
  Link,
  List,
  ListItem,
  type OrcaNode,
  RelativeTime,
  type RelativeTimeCell,
  Row,
  read,
  Separator,
  Stack,
  set,
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

/** Cartão das seções: borda, cantos e fundo do tema, com menos espaço interno que o Card nativo (que não aceita padding). */
export function Secao({ titulo, descricao, children }: { titulo?: string; descricao?: string; children?: OrcaNode }) {
  return (
    <Box border radius="lg" background="card" padding="lg" gap="md">
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

/**
 * Detalhe: [rótulo, valor, íntegro?]; o valor pode ser um tempo relativo, que o Orca mantém atualizado. `íntegro` = sem quebra
 * opcional (valor para copiar e colar no terminal); longo, aparece recolhido com "ver mais".
 */
export type Detalhe = [string, string | number | RelativeTimeCell, boolean?]
/** Linha de detalhe condicional: some quando o valor é vazio ou falso. */
export const se = (rotulo: string, valor: string | false | null | undefined): Detalhe[] => (valor ? [[rotulo, valor]] : [])
export type Linha = { key: string; cells: Record<string, TableCell>; detalhes: Detalhe[] }
type Coluna = {
  key: string
  label: string
  align?: 'start' | 'center' | 'end'
  /** Largura em px: mínima na primeira coluna (que cresce) e fixa nas demais. */
  largura: number
}

/** Largura (px) da coluna da seta, do respiro entre as colunas e do recuo do ListItem (8 de cada lado), para a soma da largura mínima da tabela. */
const LARGURA_SETA = 10
const RESPIRO_COLUNA = 8
const RECUO_LINHA = 16
/** O host não mede linhas: acima disto (~2 linhas no painel estreito) o valor íntegro recolhe numa linha com "ver mais". */
const LIMITE_RECOLHIDO = 60
/** Valores íntegros abertos com "ver mais", por `<linha>#<rótulo>`. */
const inteiros = atom<string[]>([])
const alternado = (lista: string[], k: string) => (lista.includes(k) ? lista.filter(x => x !== k) : [...lista, k])
/** Largura do rótulo na linha de detalhe; o valor ocupa o resto e quebra linha. */
const LARGURA_ROTULO = '35%'
/** Pontos onde o navegador pode quebrar um valor longo (caminho, comando, endereço). */
const PONTOS_DE_QUEBRA = /([/\\_:-])/g
/** O Text do Orca não quebra palavra: um ZWSP depois de / \ _ : - deixa quebrar sem mudar o texto à vista. */
const quebravel = (s: string) => s.replace(PONTOS_DE_QUEBRA, '$1​')
/** Rótulo do cabeçalho em maiúsculas, nas regras do idioma do painel. */
function maiusculas(s: string): string {
  try {
    return s.toLocaleUpperCase(env.locale || undefined)
  } catch {
    return s.toUpperCase()
  }
}

function Valor({ v, truncar, quebrar, ...props }: { v: TableCell | RelativeTimeCell; truncar?: boolean; quebrar?: boolean } & TextProps) {
  // `\n` no valor: um Text por linha.
  if (typeof v === 'string' && v.includes('\n'))
    return (
      <Box gap="none">
        {v.split('\n').map(linha => (
          <Valor key={linha} v={linha} truncar={truncar} quebrar={quebrar} {...props} />
        ))}
      </Box>
    )
  return (
    <Text {...props} truncate={truncar}>
      {typeof v === 'object' && v !== null ? (
        <RelativeTime at={v.at} format={v.format} />
      ) : quebrar ? (
        quebravel(String(v ?? ''))
      ) : (
        String(v ?? '')
      )}
    </Text>
  )
}

/**
 * Tabela própria (List + Box, com o tema do Orca): contorno arredondado, cabeçalho em maiúsculas, uma List por linha (a linha
 * inteira é o clique) com divisória entre elas e, na aberta, um bloco de duas colunas (rótulo e valor inteiro) colado nela.
 * Várias abertas; clicar de novo recolhe. Abaixo da largura mínima das colunas rola na horizontal, dentro do contorno. Só leitura.
 */
export function TabelaExpansivel(props: {
  label: string
  colunas: Coluna[]
  linhas: Linha[]
  abertas: string[]
  onAbrir: (keys: string[]) => void
}) {
  const larguraMinima = RECUO_LINHA + LARGURA_SETA + props.colunas.reduce((n, c) => n + c.largura + RESPIRO_COLUNA, 0)
  const celula = (prefixo: string, c: Coluna, i: number, conteudo: OrcaNode) => (
    <Box
      key={`${prefixo}.${c.key}`}
      direction="row"
      justify={c.align === 'end' ? 'end' : 'start'}
      grow={i === 0}
      shrink={i === 0}
      minWidth={i === 0 ? c.largura : undefined}
      width={i === 0 ? undefined : c.largura}
    >
      {conteudo}
    </Box>
  )
  // Seta e colunas num só array: as chaves das células ficam visíveis (e testáveis).
  const linhaDe = (prefixo: string, seta: OrcaNode, celulas: (c: Coluna, i: number) => OrcaNode) => (
    <Box direction="row" gap="sm" align="center">
      {[
        <Box key={`${prefixo}.seta`} width={LARGURA_SETA} shrink={false}>
          {seta}
        </Box>,
        ...props.colunas.map((c, i) => celula(prefixo, c, i, celulas(c, i))),
      ]}
    </Box>
  )
  const alternar = (k: string) => props.onAbrir(alternado(props.abertas, k))
  return (
    <Box key={`tabela:${props.label}`} border radius="md">
      <Box scroll="x">
        <Box gap="none" minWidth={larguraMinima}>
          {[
            // Cabeçalho também em ListItem (sem clique) para ter o mesmo recuo das linhas.
            <List key="cabecalho" label={props.label}>
              <ListItem>
                {linhaDe('cabecalho', null, c => (
                  <Text size="xs" muted weight="semibold" truncate>
                    {maiusculas(c.label)}
                  </Text>
                ))}
              </ListItem>
            </List>,
            ...props.linhas.flatMap(l => {
              const aberta = props.abertas.includes(l.key)
              return [
                <Separator key={`${l.key}#divisoria`} />,
                // Uma List por linha: o ListItem dá o clique na linha inteira e o hover do tema; a List só aceita ListItem.
                <List key={l.key} label={`${props.label}: ${l.key}`}>
                  <ListItem onPress={() => alternar(l.key)}>
                    {linhaDe(l.key, <Text muted>{aberta ? '⌄' : '›'}</Text>, c => (
                      <Valor v={l.cells[c.key]} truncar />
                    ))}
                  </ListItem>
                </List>,
                ...(aberta
                  ? [
                      <Box key={`${l.key}#detalhes`} background="muted" radius="md" padding="sm" gap="sm" margin="xs">
                        {l.detalhes.flatMap(([rotulo, valor, integro], i) => {
                          const recolhivel = integro && typeof valor === 'string' && valor.length > LIMITE_RECOLHIDO
                          const chave = `${l.key}#${rotulo}`
                          const inteiro = read(inteiros).includes(chave)
                          return [
                            ...(i > 0 ? [<Separator key={`${l.key}#${i}:divisoria`} />] : []),
                            <Box key={`${l.key}#${i}`} direction="row" gap="sm" align="start">
                              <Box key={`${l.key}#${i}:rotulo`} width={LARGURA_ROTULO} shrink={false}>
                                <Text size="sm" muted>
                                  {rotulo}
                                </Text>
                              </Box>
                              <Box key={`${l.key}#${i}:valor`} grow gap="xs">
                                {/* Recolhido: uma linha cortada na largura real, e o "ver mais" na segunda. */}
                                <Valor v={valor} size="sm" quebrar={!integro} truncar={recolhivel && !inteiro} />
                                {recolhivel ? (
                                  <Text size="sm">
                                    <Link onPress={() => set(inteiros, alternado(read(inteiros), chave))}>
                                      {inteiro ? t.verMenos : t.verMais}
                                    </Link>
                                  </Text>
                                ) : null}
                              </Box>
                            </Box>,
                          ]
                        })}
                      </Box>,
                    ]
                  : []),
              ]
            }),
          ]}
        </Box>
      </Box>
    </Box>
  )
}
