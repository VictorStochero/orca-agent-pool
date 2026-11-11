// Auxiliares dos testes da tabela própria: uma List de cabeçalho, uma List por linha e um bloco de detalhes na aberta.
import type { TestElement, TestPanel, TreeSnapshot } from 'orca/testing'

/** A List do cabeçalho (existe quando a tabela existe); o texto das linhas e dos detalhes vem por `texto`/`tem`. */
export const lista = (label: string) => ({ type: 'List', label })

const listasDeLinha = (v: TestPanel, label: string): TestElement[] =>
  v.findAll({ type: 'List', label: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `) })

/** Chaves, na ordem desenhada, das linhas; a aberta é seguida de `<linha>#detalhes`. */
export function chaves(v: TestPanel, label: string): string[] {
  return listasDeLinha(v, label).flatMap(l => {
    const k = String(l.label).slice(label.length + 2)
    return v.find({ testId: `${k}#detalhes` }) ? [k, `${k}#detalhes`] : [k]
  })
}

/** Clica a linha de chave `key` (a linha inteira é o ListItem). */
export function abrir(v: TestPanel, key: string): Promise<void> {
  const l = v.findAll({ type: 'List' }).find(x => String(x.label).endsWith(`: ${key}`))
  const item = l && v.findAll({ type: 'ListItem' }).find(e => e.path.startsWith(`${l.path}/`))
  if (!item) throw new Error(`linha ${key} não encontrada`)
  return v.press(item)
}

export const ZWSP = '​'
export const semZwsp = (s: string) => s.split(ZWSP).join('')

/** Texto da tabela inteira (cabeçalho, linhas e detalhes) sem os ZWSP que deixam os valores longos quebrarem. */
export function texto(v: TestPanel, label: string): string {
  const cab = v.find(lista(label))?.text
  if (cab === undefined) return ''
  const partes = chaves(v, label).map(
    k => (k.endsWith('#detalhes') ? v.find({ testId: k }) : v.find({ type: 'List', label: `${label}: ${k}` }))?.text,
  )
  return semZwsp([cab, ...partes].join(' '))
}

/** Casa o regex com o texto da tabela inteira; devolve o resultado do match (ou null). */
export const tem = (v: TestPanel, q: { label: string }, re: RegExp) => texto(v, q.label).match(re)

/** Texto da célula `coluna` da linha `key`. */
export const celula = (v: TestPanel, key: string, coluna: string) => v.find({ testId: `${key}.${coluna}` })?.text

/** Rótulos da linha de cabeçalho. */
export const cabecalho = (v: TestPanel, colunas: string[]) => colunas.map(c => v.find({ testId: `cabecalho.${c}` })?.text)

/** Valor e rótulo do item `i` do bloco de detalhes da linha `key`; o valor sem ZWSP. */
export const valorDe = (v: TestPanel, key: string, i: number) => {
  const x = v.find({ testId: `${key}#${i}:valor` })?.text
  return x === undefined ? null : semZwsp(x)
}
export const rotuloDe = (v: TestPanel, key: string, i: number) => v.find({ testId: `${key}#${i}:rotulo` })?.text ?? null

/** Nó da árvore desenhada (`tree()`), com a lista dos tipos+props dos ancestrais; `findAll` não lista todo Box. */
export type No = {
  type: string
  key?: string
  props: Record<string, unknown>
  ancestrais: { type: string; props: Record<string, unknown> }[]
}
export function nos(v: TestPanel): No[] {
  const saida: No[] = []
  const anda = (n: TreeSnapshot | string | null, anc: No['ancestrais']) => {
    if (!n || typeof n === 'string') return
    const props = n.props ?? {}
    saida.push({ type: n.type, key: n.key, props, ancestrais: anc })
    for (const c of n.children ?? []) anda(c, [...anc, { type: n.type, props }])
  }
  anda(v.tree(), [])
  return saida
}
