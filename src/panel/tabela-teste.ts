// Auxiliares dos testes da tabela própria (List + Box): achar a lista, abrir linha, ler chaves e células.
import type { TestElement, TestPanel } from 'orca/testing'

export const lista = (label: string) => ({ type: 'List', label })

/** O Orca põe a chave de um ListItem clicável no fim do `path` (`…/#1.p4242`), não em `key`. */
const chaveDe = (e: TestElement) =>
  e.key ??
  e.path
    .split('/')
    .pop()!
    .replace(/^#\d+\./, '')

/** ListItems da lista, na ordem desenhada (o cabeçalho fica de fora). */
const itens = (v: TestPanel, label: string): TestElement[] => {
  const raiz = v.find(lista(label))?.path
  return raiz ? v.findAll({ type: 'ListItem' }).filter(e => e.path.startsWith(`${raiz}/`) && e.key !== 'cabecalho') : []
}

/** Chaves dos itens (o bloco de detalhes aparece como `<linha>#detalhes`). */
export const chaves = (v: TestPanel, label: string): string[] => itens(v, label).map(chaveDe)

/** Clica a linha de chave `key`. */
export function abrir(v: TestPanel, key: string): Promise<void> {
  const item = v.findAll({ type: 'ListItem' }).find(e => chaveDe(e) === key)
  if (!item) throw new Error(`linha ${key} não encontrada`)
  return v.press(item)
}

/** Texto da célula `coluna` da linha `key`. */
export const celula = (v: TestPanel, key: string, coluna: string) => v.find({ testId: `${key}.${coluna}` })?.text

/** Rótulos da linha de cabeçalho. */
export const cabecalho = (v: TestPanel, colunas: string[]) => colunas.map(c => v.find({ testId: `cabecalho.${c}` })?.text)
