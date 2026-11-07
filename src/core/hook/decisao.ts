import { nomeDoExecutavel as base, semAtribuicoes } from '../executavel.ts'

/** `reservaViva`: há reserva `res-` pendente; ausente = true (quem não checa não bloqueia `worker-start`). */
export type Entrada = { comando: string; reservaViva?: boolean }
/** `trecho`: a parte do comando negada, para o CLI montar a sugestão; `motivo`: teste fora da fila ou `worker-start` sem reserva. */
export type Decisao = { permitir: boolean; trecho?: string; motivo?: 'teste' | 'reserva' }

type Negado = { trecho: string; motivo: 'teste' | 'reserva' }

const SEPARADORES = new Set([';', '&', '|', '\n', '\r'])
const SHELLS = /^(bash|sh|zsh|pwsh|powershell)$/
const BUSCA = /^(grep|egrep|fgrep|rg|findstr|select-string)$/
const SO_LISTA = /--(list-tests|collect-only|listTests)\b|\bvitest\s+list\b/

/** Divide em trechos nos separadores fora de aspas. */
function trechos(s: string): { texto: string; separador: string }[] {
  const saida: { texto: string; separador: string }[] = []
  let atual = ''
  let aspa = ''
  let substituicao = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (aspa) {
      if (c === '\\' && aspa === '"') atual += c + (s[++i] ?? '')
      else {
        if (c === aspa) aspa = ''
        atual += c
      }
    } else if (c === '"' || c === "'") {
      aspa = c
      atual += c
    } else if (c === '$' && s[i + 1] === '(') {
      substituicao++
      atual += c + s[++i]
    } else if (c === ')' && substituicao > 0) {
      substituicao--
      atual += c
    } else if (!substituicao && SEPARADORES.has(c) && !(c === '&' && (s[i - 1] === '>' || s[i + 1] === '>'))) {
      const separador = (c === '&' || c === '|') && s[i + 1] === c ? c + s[++i] : c
      saida.push({ texto: atual.trim(), separador })
      atual = ''
    } else atual += c
  }
  saida.push({ texto: atual.trim(), separador: '' })
  return saida
}

/** Palavras do trecho sem as aspas. */
function palavras(s: string): string[] {
  const out: string[] = []
  let atual = ''
  let aspa = ''
  let aberta = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (aspa) {
      if (c === aspa) aspa = ''
      else if (c === '\\' && aspa === '"' && /["\\$`]/.test(s[i + 1] ?? '')) atual += s[++i]
      else atual += c
    } else if (c === '"' || c === "'") {
      aspa = c
      aberta = true
    } else if (/\s/.test(c)) {
      if (atual || aberta) out.push(atual)
      atual = ''
      aberta = false
    } else atual += c
  }
  if (atual || aberta) out.push(atual)
  return out
}

/** Corpos de $(...) e `...` fora de aspas simples (a análise do trecho não os vê); crase sem par vale até o fim do trecho. */
function substituicoes(s: string): string[] {
  const sem = s.replace(/'[^']*'/g, "''")
  return [...sem.matchAll(/\$\(([^)]*)\)|`([^`]*)`?/g)].map(m => m[1] ?? m[2])
}

/** O trecho (já em palavras, sem atribuições) roda teste ou mexe no banco de teste? */
function ehTeste(t: string[]): boolean {
  let i = 0
  while (['npx', 'bunx', 'time', 'nohup', 'sudo', 'command'].includes(base(t[i] ?? ''))) i++
  if (['uv', 'poetry', 'pipenv'].includes(base(t[i] ?? '')) && t[i + 1] === 'run') i += 2
  else if (base(t[i] ?? '') === 'pnpm' && ['exec', 'dlx'].includes(t[i + 1])) i += 2
  else if (base(t[i] ?? '') === 'bundle' && t[i + 1] === 'exec') i += 2
  const programa = base(t[i] ?? '')
  const args = t.slice(i + 1)
  const teste = /^test(:[\w:-]+)?$/
  if (['pytest', 'py.test', 'vitest', 'jest', 'rspec', 'phpunit', 'pest'].includes(programa)) return true
  if (programa === 'cargo') return args[0] === 'test' || args[0] === 'nextest'
  if (['go', 'dotnet'].includes(programa)) return args[0] === 'test'
  if (programa === 'artisan') return args[0] === 'test'
  // Invólucros de container: o teste está em algum sufixo (`docker compose exec app php artisan test`).
  if (['docker', 'docker-compose', 'podman', 'ddev'].includes(programa)) return args.some((_, k) => ehTeste(args.slice(k)))
  if (['npm', 'pnpm'].includes(programa) && args[0] === 't') return true
  if (programa === 'sail') return args[0] === 'test' || args[0] === 'pest'
  if (programa === 'composer') return teste.test(args[0] === 'run' || args[0] === 'run-script' ? (args[1] ?? '') : (args[0] ?? ''))
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(programa)) return teste.test(args[0] === 'run' ? (args[1] ?? '') : (args[0] ?? ''))
  const resto = args.join(' ')
  if (programa === 'php') {
    if (/(^|\/)(pest|phpunit)$/.test(args[0] ?? '')) return true
    if (!/artisan$/.test(args[0] ?? '')) return false
    if (args[1] === 'test') return true
    const banco = /^(migrate(:[\w-]+)?|db:(wipe|seed))$/.test(args[1] ?? '')
    return (
      banco && (/--env(=|\s+)testing(\s|$)/.test(resto) || /--database(=|\s+)([\w.-]*[_.-])?test(ing)?([_.-][\w.-]*)?(\s|$)/.test(resto))
    )
  }
  if (/^python[\d.]*$|^py$/.test(programa)) {
    if (args[0] === '-m') return args[1] === 'pytest' || args[1] === 'unittest'
    if (!/manage\.py$/.test(args[0] ?? '')) return false
    return args[1] === 'test' || (/^(migrate|flush)$/.test(args[1] ?? '') && /--settings(=|\s+)[\w.]*test[\w.]*(\s|$)/.test(resto))
  }
  return false
}

/** Trecho sem agrupamento `( … )` / `{ …; }`, crase nem espaço nas pontas: não mudam o que roda. */
const semPontas = (t: string): string => t.replace(/^[({`\s]+/, '').replace(/[)}`\s]+$/, '')

/** Palavras do trecho sem agrupamento `( … )` / `{ …; }`, crase nas pontas, `VAR=x` nem `env`: não mudam o que roda. */
function comando(trecho: string): string[] {
  // A crase não segura o corte (sem par, desligaria o resto do comando): o separador dentro dela corta e a ponta sai aqui.
  let t = palavras(trecho).map(semPontas).filter(Boolean)
  for (;;) {
    t = semAtribuicoes(t)
    if (base(t[0] ?? '') !== 'env') break
    t = t.slice(1)
    while (t.length && t[0].startsWith('-')) t = t.slice(1)
  }
  return t
}

/** Sucesso do trecho implica sucesso da reserva, inclusive atribuição cujo código é o da substituição. */
function reserva(texto: string): boolean {
  const partes = trechos(texto)
  if (partes.some(p => p.separador !== '' && p.separador !== '&&')) return false
  return partes.some(({ texto: trecho }) => {
    if (/^[A-Za-z_]\w*=(?:"?\$\([\s\S]*\)"?|`[^`]*`)\s*$/.test(trecho)) {
      const subs = substituicoes(trecho)
      return subs.length === 1 && reserva(subs[0])
    }
    const t = comando(trecho)
    if (base(t[0] ?? '') !== 'agent-pool') return false
    return (t[1] === 'writer' && t.includes('--reserve')) || (t[1] === 'slot' && t[2] === 'take' && /^res-/.test(t[4] ?? ''))
  })
}

function primeiroNegado(texto: string, reservaViva: boolean): Negado | null {
  let encadeada = false
  let anterior = ''
  for (const { texto: trecho, separador } of trechos(texto)) {
    if (anterior !== '&&') encadeada = false
    const temReserva = reservaViva || encadeada
    for (const sub of substituicoes(trecho)) {
      const x = primeiroNegado(sub, temReserva)
      if (x) return x
    }
    encadeada = separador === '&&' && (encadeada || (!['|', '||'].includes(anterior) && reserva(trecho)))
    anterior = separador
    const t = comando(trecho)
    if (!t.length) continue
    const e = base(t[0])
    if (e === 'agent-pool' && t[1] === 'test') continue
    if (BUSCA.test(e)) continue
    if (SHELLS.test(e)) {
      const k = t.findIndex((a, n) => n > 0 && /^-(l?c|command)$/i.test(a))
      if (k > 0 && t[k + 1] !== undefined) {
        const x = primeiroNegado(t[k + 1], temReserva)
        if (x) return x
        continue
      }
    }
    if (
      !temReserva &&
      /^orca(-ide|-dev)?$/.test(e) &&
      t[1] === 'orchestration' &&
      t[2] === 'worker-start' &&
      !t.some(a => a === '--help' || a === '-h')
    ) {
      // shortcut: sem consultar o Orca, send não revela dispatch novo; o agente reaberto conta vaga ao abrir a sessão (agente vivo).
      return { trecho: semPontas(trecho), motivo: 'reserva' }
    }
    if (SO_LISTA.test(trecho)) continue
    // `pip install pytest` e afins não rodam teste
    if (
      /^(pip3?|uv|poetry|pipenv|npm|pnpm|yarn|bun|composer)$/.test(e) &&
      /^(install|add|i|ci|sync|remove|uninstall|require)$/.test(t[1] ?? '')
    )
      continue
    if (ehTeste(t)) return { trecho: semPontas(trecho), motivo: 'teste' }
  }
  return null
}

/**
 * Apaga o corpo de `cat`/`tee` com heredoc de delimitador entre aspas (`<<'EOF'`): o shell não o expande, é texto
 * (mensagem de commit, corpo de PR, arquivo) e não comando. A linha do delimitador e as seguintes ficam.
 * Heredoc sem aspas continua analisado (nele a substituição de comando roda); com pipe depois do `<<`, o corpo pode ir a um shell.
 */
function semCorpoDeHeredoc(texto: string): string {
  const saida: string[] = []
  let delimitador: string | null = null
  for (const linha of texto.split('\n')) {
    if (delimitador !== null) {
      if (linha.trim() !== delimitador) continue
      delimitador = null
    }
    saida.push(linha)
    const m = /\b(?:cat|tee)\b[^<\n]*<<-?\s*(["'])(\w+)\1/.exec(linha)
    if (m && !linha.slice(m.index + m[0].length).includes('|')) delimitador = m[2]
  }
  return saida.join('\n')
}

/** Teste fora de `agent-pool test` e `orca orchestration worker-start` sem reserva são negados com o comando certo. */
export function decidir(e: Entrada): Decisao {
  const texto = semCorpoDeHeredoc(e.comando.replace(/\r\n/g, '\n'))
  const negado = primeiroNegado(texto, e.reservaViva ?? true)
  return negado ? { permitir: false, ...negado } : { permitir: true }
}
