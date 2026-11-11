// Tradução do comando de teste no comando que só lista os testes (para o total da barra de progresso) e contagem da listagem.

export type TipoListagem = 'phpunit'
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

/** Comando que lista os testes do comando de teste dado (já sem `VAR=x`); null se a ferramenta não tem listagem conhecida (só artisan/Pest/PHPUnit). */
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
  return null
}

/** Quantos testes a listagem trouxe; null se nenhum (listagem sem teste não vira total). */
export function contarListagem(_tipo: TipoListagem, saida: string): number | null {
  const linhas = saida
    .replace(ANSI, '')
    .split(/\r\n|\n|\r/)
    .map(l => l.trim())
  const inicio = linhas.findIndex(l => /Available tests/i.test(l))
  if (inicio < 0) return null
  const n = linhas.slice(inicio + 1).filter(l => /^-\s+\S/.test(l)).length
  return n > 0 ? n : null
}
