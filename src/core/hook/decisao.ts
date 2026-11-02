export type Entrada = { comando: string; agente: 'claude' | 'codex' }
/** `trecho`: a parte do comando que roda teste, para o CLI montar a sugestão. */
export type Decisao = { permitir: boolean; trecho?: string }

const SEPARADORES = new Set([';', '&', '|', '\n', '\r'])
const SHELLS = /^(bash|sh|zsh|pwsh|powershell)$/
const BUSCA = /^(grep|egrep|fgrep|rg|findstr|select-string)$/
const SO_LISTA = /--(list-tests|collect-only|listTests)\b|\bvitest\s+list\b/

/** Divide em trechos nos separadores fora de aspas. */
function trechos(s: string): string[] {
  const saida: string[] = []
  let atual = ''
  let aspa = ''
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
    } else if (SEPARADORES.has(c) && !(c === '&' && (s[i - 1] === '>' || s[i + 1] === '>'))) {
      saida.push(atual)
      atual = ''
    } else atual += c
  }
  saida.push(atual)
  return saida.map((t) => t.trim()).filter(Boolean)
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

/** Corpos de $(...) e `...` fora de aspas simples (a análise do trecho não os vê). */
function substituicoes(s: string): string[] {
  const sem = s.replace(/'[^']*'/g, "''")
  return [...sem.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)].map((m) => m[1] ?? m[2])
}

const base = (t: string) => (t.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat)$/, '')

/** O trecho (já em palavras, sem atribuições) roda teste ou mexe no banco de teste? */
function ehTeste(t: string[]): boolean {
  let i = 0
  while (['npx', 'bunx', 'time', 'nohup', 'sudo', 'command'].includes(base(t[i] ?? ''))) i++
  if (['uv', 'poetry', 'pipenv'].includes(base(t[i] ?? '')) && t[i + 1] === 'run') i += 2
  else if (base(t[i] ?? '') === 'pnpm' && ['exec', 'dlx'].includes(t[i + 1])) i += 2
  else if (base(t[i] ?? '') === 'bundle' && t[i + 1] === 'exec') i += 2
  const e = base(t[i] ?? '')
  const r = t.slice(i + 1)
  const teste = /^test(:[\w:-]+)?$/
  if (['pytest', 'py.test', 'vitest', 'jest', 'rspec', 'phpunit', 'pest'].includes(e)) return true
  if (e === 'cargo') return r[0] === 'test' || r[0] === 'nextest'
  if (['go', 'dotnet'].includes(e)) return r[0] === 'test'
  if (e === 'artisan') return r[0] === 'test'
  // Invólucros de container: o teste está em algum sufixo (`docker compose exec app php artisan test`).
  if (['docker', 'docker-compose', 'podman', 'ddev'].includes(e)) return r.some((_, k) => ehTeste(r.slice(k)))
  if (['npm', 'pnpm'].includes(e) && r[0] === 't') return true
  if (e === 'sail') return r[0] === 'test' || r[0] === 'pest'
  if (e === 'composer') return teste.test(r[0] === 'run' || r[0] === 'run-script' ? (r[1] ?? '') : (r[0] ?? ''))
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(e)) return teste.test(r[0] === 'run' ? (r[1] ?? '') : (r[0] ?? ''))
  const resto = r.join(' ')
  if (e === 'php') {
    if (/(^|\/)(pest|phpunit)$/.test(r[0] ?? '')) return true
    if (!/artisan$/.test(r[0] ?? '')) return false
    if (r[1] === 'test') return true
    const banco = /^(migrate(:[\w-]+)?|db:(wipe|seed))$/.test(r[1] ?? '')
    return banco && (/--env(=|\s+)testing(\s|$)/.test(resto) || /--database(=|\s+)([\w.-]*[_.-])?test(ing)?([_.-][\w.-]*)?(\s|$)/.test(resto))
  }
  if (/^python[\d.]*$|^py$/.test(e)) {
    if (r[0] === '-m') return r[1] === 'pytest' || r[1] === 'unittest'
    if (!/manage\.py$/.test(r[0] ?? '')) return false
    return r[1] === 'test' || (/^(migrate|flush)$/.test(r[1] ?? '') && /--settings(=|\s+)[\w.]*test[\w.]*(\s|$)/.test(resto))
  }
  return false
}

function acha(texto: string): string | null {
  for (const sub of substituicoes(texto)) {
    const x = acha(sub)
    if (x) return x
  }
  for (const trecho of trechos(texto)) {
    // Agrupamento `( … )` / `{ …; }` e `env VAR=x` não mudam o que roda.
    let t = palavras(trecho).map((w) => w.replace(/^[({]+|[)}]+$/g, '')).filter(Boolean)
    for (;;) {
      while (t.length && /^[A-Za-z_]\w*=/.test(t[0])) t = t.slice(1)
      if (base(t[0] ?? '') !== 'env') break
      t = t.slice(1)
      while (t.length && t[0].startsWith('-')) t = t.slice(1)
    }
    if (!t.length) continue
    const e = base(t[0])
    if (e === 'agent-pool' && t[1] === 'test') continue
    if (BUSCA.test(e)) continue
    if (SHELLS.test(e)) {
      const k = t.findIndex((a, n) => n > 0 && /^-(l?c|command)$/i.test(a))
      if (k > 0 && t[k + 1] !== undefined) {
        const x = acha(t[k + 1])
        if (x) return x
        continue
      }
    }
    if (SO_LISTA.test(trecho)) continue
    // `pip install pytest` e afins não rodam teste
    if (/^(pip3?|uv|poetry|pipenv|npm|pnpm|yarn|bun|composer)$/.test(e) && /^(install|add|i|ci|sync|remove|uninstall|require)$/.test(t[1] ?? '')) continue
    if (ehTeste(t)) return trecho.replace(/^[({\s]+/, '').replace(/[)}\s]+$/, '')
  }
  return null
}

/** Comando de teste (ou banco de teste) fora de `agent-pool test` é negado com o comando certo. */
export function decidir(e: Entrada): Decisao {
  const trecho = acha(e.comando.replace(/\r\n/g, '\n'))
  if (!trecho) return { permitir: true }
  return { permitir: false, trecho }
}
