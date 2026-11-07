import { execFile } from 'node:child_process'

const comando = (filtro: string, saida: string) => [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `Get-CimInstance Win32_Process -Filter "${filtro}" | ForEach-Object { ${saida} }`,
]
const OPCOES = { windowsHide: true, timeout: 10_000, encoding: 'utf8' } as const
const linhas = (stdout: string) =>
  stdout
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)

/** Linhas que `saida` (PowerShell) imprime por processo de `filtro` (WQL); null se a consulta falhou. */
export function consultarProcessos(filtro: string, saida: string): Promise<string[] | null> {
  return new Promise(resolve =>
    execFile('powershell.exe', comando(filtro, saida), OPCOES, (erro, stdout) => resolve(erro ? null : linhas(stdout))),
  )
}

/** Veredito de consulta guardado até `ate` (ms Unix; Infinity = definitivo). */
export class CachePrazo<V> {
  #itens = new Map<string, { ate: number; valor: V }>()

  obter(chave: string, agora: number): V | undefined {
    const item = this.#itens.get(chave)
    return item && item.ate > agora ? item.valor : undefined
  }

  guardar(chave: string, valor: V, ate: number): void {
    const agora = Date.now()
    for (const [k, i] of this.#itens) if (i.ate <= agora) this.#itens.delete(k)
    this.#itens.set(chave, { ate, valor })
  }
}
