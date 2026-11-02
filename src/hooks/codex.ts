import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gravar } from './gravar.ts'

// Codex: grupo sem matcher em PreToolUse; hook novo só roda com confiança no config.toml.
export const codex = {
  agente: 'codex',
  pasta: (home: string) => join(home, '.codex'),
  arquivo: (dir: string) => join(dir, 'hooks.json'),
  grupo: (lancador: string) => ({
    hooks: [{ type: 'command', command: `"${lancador}" hook codex`, timeout: 10 }]
  })
}

const tomlDe = (dir: string) => join(dir, 'config.toml')

// Igual ao json.dumps do Python (ensure_ascii) que o Codex usa para o hash.
const js = (s: string) => JSON.stringify(s).replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

export function hashConfianca(comando: string, timeout: number): string {
  const corpo = `{"event_name":"pre_tool_use","hooks":[{"async":false,"command":${js(comando)},"timeout":${timeout},"type":"command"}]}`
  return 'sha256:' + createHash('sha256').update(corpo).digest('hex')
}

/** Windows: o Codex confere as duas grafias do caminho (C:\... e C:/...). */
function grafias(hooksJson: string): string[] {
  const barra = hooksJson.replace(/\\/g, '/')
  return /^[A-Za-z]:\//.test(barra) ? [barra, barra.replace(/\//g, '\\')] : [hooksJson]
}

/** Chave TOML: string literal; com apóstrofo no caminho, string básica com escapes. */
const chaveToml = (chave: string) => (chave.includes("'") ? `"${chave.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : `'${chave}'`)

const bloco = (chave: string, hash: string) => `\n[hooks.state.${chaveToml(chave)}]\nenabled = true\ntrusted_hash = "${hash}"\n`

const chaveDe = (caminho: string, n: number) => `${caminho}:pre_tool_use:${n}:0`

/** Chave de um cabeçalho `[hooks.state.<chave>]` (literal ou básica), ou null. */
function chaveDoCabecalho(linha: string): string | null {
  const m = /^\s*\[hooks\.state\.(?:'([^']*)'|"((?:[^"\\]|\\.)*)")\]\s*(?:#.*)?$/.exec(linha)
  if (!m) return null
  return m[1] ?? m[2].replace(/\\(["\\])/g, '$1')
}

/** Faixas [início, fim) das linhas das tabelas com essa chave: do cabeçalho até o próximo cabeçalho, sem as linhas em branco do fim. */
function tabelasDa(linhas: string[], chave: string): [number, number][] {
  const faixas: [number, number][] = []
  linhas.forEach((l, i) => {
    if (chaveDoCabecalho(l) !== chave) return
    let fim = i + 1
    while (fim < linhas.length && !/^\s*\[/.test(linhas[fim])) fim++
    while (fim > i + 1 && linhas[fim - 1].trim() === '') fim--
    faixas.push([i, fim])
  })
  return faixas
}

const linhasDe = (texto: string) => texto.match(/[^\n]*\n|[^\n]+$/g) ?? []

/** Remove as tabelas com a chave (e a linha em branco que as antecede). */
function tirar(texto: string, chave: string): string {
  const linhas = linhasDe(texto)
  for (const [ini, fim] of tabelasDa(linhas, chave).reverse()) {
    const antes = ini > 0 && linhas[ini - 1].trim() === '' ? 1 : 0
    linhas.splice(ini - antes, fim - ini + antes)
  }
  return linhas.join('')
}

/** Grava a confiança do hook; devolve true se alterou o config.toml. `antes` faz o backup do original. */
export function confiar(dir: string, hooksJson: string, n: number, comando: string, timeout: number, antes: (arq: string) => void): boolean {
  const arq = tomlDe(dir)
  const atual = existsSync(arq) ? readFileSync(arq, 'utf8') : ''
  let novo = atual
  for (const caminho of grafias(hooksJson)) {
    const chave = chaveDe(caminho, n)
    const b = bloco(chave, hashConfianca(comando, timeout))
    const linhas = linhasDe(novo)
    const faixas = tabelasDa(linhas, chave)
    // Já está certo (uma só tabela, mesmo conteúdo): não mexe, para ser idempotente.
    if (faixas.length === 1 && linhas.slice(faixas[0][0], faixas[0][1]).join('').trim() === b.trim()) continue
    novo = tirar(novo, chave)
    novo += (novo !== '' && !novo.endsWith('\n') ? '\n' : '') + b
  }
  if (novo === atual) return false
  antes(arq)
  gravar(arq, novo)
  return true
}

/** Remove a confiança desse hook pela chave (qualquer hash, qualquer grafia de aspas); devolve true se alterou. */
export function desconfiar(dir: string, hooksJson: string, n: number): boolean {
  const arq = tomlDe(dir)
  if (!existsSync(arq)) return false
  const atual = readFileSync(arq, 'utf8')
  let novo = atual
  for (const caminho of grafias(hooksJson)) novo = tirar(novo, chaveDe(caminho, n))
  if (novo === atual) return false
  gravar(arq, novo)
  return true
}

/** Acompanha o grupo que mudou de índice no hooks.json: a confiança é por índice, então a chave precisa andar junto. */
export function renomearConfianca(dir: string, hooksJson: string, de: number, para: number): boolean {
  const arq = tomlDe(dir)
  if (!existsSync(arq)) return false
  const atual = readFileSync(arq, 'utf8')
  const linhas = linhasDe(atual)
  for (const caminho of grafias(hooksJson)) {
    const velha = chaveDe(caminho, de)
    linhas.forEach((l, i) => {
      if (chaveDoCabecalho(l) !== velha) return
      const quebra = l.match(/\r?\n$/)?.[0] ?? ''
      linhas[i] = `[hooks.state.${chaveToml(chaveDe(caminho, para))}]${quebra}`
    })
  }
  const novo = linhas.join('')
  if (novo === atual) return false
  gravar(arq, novo)
  return true
}
