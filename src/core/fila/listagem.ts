// Tradução do comando de teste no comando que só lista os testes (para o total da barra de progresso) e contagem da listagem.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type TipoListagem = 'phpunit' | 'vitest'
export type PlanoListagem = { comando: string[]; tipo: TipoListagem }

// biome-ignore lint/suspicious/noControlCharactersInRegex: o ESC é o que se quer remover
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

/** Flags que só mudam a execução: somem da listagem. `valor`: aceitam o valor separado (`--processes 4`). */
type Descarte = { exatas: Set<string>; prefixos: RegExp; valor: RegExp }

const PHP: Descarte = {
  exatas: new Set(['--parallel', '-p', '--compact', '--drop-databases', '--recreate-databases', '--profile', '--bail', '--retry', '--ci']),
  prefixos: /^(--processes|--coverage[\w-]*|--min|--stop-on-[\w-]+|--retry)(=|$)/,
  valor: /^(--processes|--coverage-(html|clover|text|xml|cobertura|php|crap4j)|--min)$/,
}
const VITEST: Descarte = {
  exatas: new Set(['run', '--run', '--watch', '-w']),
  prefixos: /^(--maxWorkers|--coverage[\w-]*|--bail|--pool|--reporter)(=|$)/,
  valor: /^(--maxWorkers|--bail|--pool|--reporter)$/,
}

function filtrar(args: string[], d: Descarte): string[] {
  const saida: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (d.exatas.has(a)) continue
    if (d.prefixos.test(a)) {
      if (d.valor.test(a) && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++
      continue
    }
    saida.push(a)
  }
  return saida
}

const barras = (s: string) => s.replace(/\\/g, '/')

/** Comando que lista os testes do comando de teste dado (já sem `VAR=x`); null se a ferramenta não tem listagem conhecida. */
export function planoDeListagem(comando: string[]): PlanoListagem | null {
  const n = comando.map(barras)
  const php = n.findIndex(p => /(^|\/)(vendor\/bin\/)?(pest|phpunit)(\.bat|\.exe)?$/.test(p))
  if (php >= 0) {
    const [prefixo, args] = [comando.slice(0, php + 1), comando.slice(php + 1)]
    return { tipo: 'phpunit', comando: [...prefixo, '--list-tests', ...filtrar(args, PHP)] }
  }
  const artisan = n.findIndex((p, i) => p === 'artisan' && n[i + 1] === 'test')
  if (artisan >= 0) {
    return { tipo: 'phpunit', comando: [...comando.slice(0, artisan + 2), '--list-tests', ...filtrar(comando.slice(artisan + 2), PHP)] }
  }
  const vitest = n.findIndex(p => /(^|\/)vitest(\.cmd)?$/.test(p))
  if (vitest >= 0) {
    return { tipo: 'vitest', comando: [...comando.slice(0, vitest + 1), 'list', ...filtrar(comando.slice(vitest + 1), VITEST)] }
  }
  return null
}

/** Quantos testes a listagem trouxe; null se nenhum (listagem sem teste não vira total). */
export function contarListagem(tipo: TipoListagem, saida: string): number | null {
  const linhas = saida
    .replace(ANSI, '')
    .split(/\r\n|\n|\r/)
    .map(l => l.trim())
  let n = 0
  if (tipo === 'phpunit') {
    const inicio = linhas.findIndex(l => /Available tests/i.test(l))
    if (inicio < 0) return null
    n = linhas.slice(inicio + 1).filter(l => /^-\s+\S/.test(l)).length
  } else {
    n = linhas.filter(l => /\S > \S/.test(l)).length
  }
  return n > 0 ? n : null
}

/** Executor detectado sem argumentos do teste: vitest no script `test` do package.json. */
export function planoDoExecutor(nome: string, dir: string): PlanoListagem | null {
  if (nome !== 'js') return null
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts?: { test?: string } }
    return /\bvitest\b/.test(pkg.scripts?.test ?? '') ? { tipo: 'vitest', comando: ['npx', 'vitest', 'list'] } : null
  } catch {
    return null
  }
}
