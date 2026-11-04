/** `reservaViva`: há reserva `res-` pendente; ausente = true (quem não checa não bloqueia `worker-start`). */
export type Entrada = { comando: string; agente: 'claude' | 'codex'; reservaViva?: boolean }
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
  return [...sem.matchAll(/\$\(([^)]*)\)|`([^`]*)`?/g)].map((m) => m[1] ?? m[2])
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

/** Palavras do trecho sem agrupamento `( … )` / `{ …; }`, crase nas pontas, `VAR=x` nem `env`: não mudam o que roda. */
function comando(trecho: string): string[] {
  // A crase não segura o corte (sem par, desligaria o resto do comando): o separador dentro dela corta e a ponta sai aqui.
  let t = palavras(trecho).map((w) => w.replace(/^[({`]+|[)}`]+$/g, '')).filter(Boolean)
  for (;;) {
    while (t.length && /^[A-Za-z_]\w*=/.test(t[0])) t = t.slice(1)
    if (base(t[0] ?? '') !== 'env') break
    t = t.slice(1)
    while (t.length && t[0].startsWith('-')) t = t.slice(1)
  }
  return t
}

/** Sucesso do trecho implica sucesso da reserva, inclusive atribuição cujo código é o da substituição. */
function reserva(texto: string): boolean {
  const partes = trechos(texto)
  if (partes.some((p) => p.separador !== '' && p.separador !== '&&')) return false
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

function acha(texto: string, reservaViva: boolean): Negado | null {
  let encadeada = false
  let anterior = ''
  for (const { texto: trecho, separador } of trechos(texto)) {
    if (anterior !== '&&') encadeada = false
    const temReserva = reservaViva || encadeada
    for (const sub of substituicoes(trecho)) {
      const x = acha(sub, temReserva)
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
        const x = acha(t[k + 1], temReserva)
        if (x) return x
        continue
      }
    }
    if (!temReserva && /^orca(-ide|-dev)?$/.test(e) && t[1] === 'orchestration' && t[2] === 'worker-start' && !t.some((a) => a === '--help' || a === '-h')) {
      // shortcut: sem consultar o Orca, send não revela dispatch novo; o agente reaberto conta vaga ao abrir a sessão (agente vivo).
      return { trecho: trecho.replace(/^[({`\s]+/, '').replace(/[)}`\s]+$/, ''), motivo: 'reserva' }
    }
    if (SO_LISTA.test(trecho)) continue
    // `pip install pytest` e afins não rodam teste
    if (/^(pip3?|uv|poetry|pipenv|npm|pnpm|yarn|bun|composer)$/.test(e) && /^(install|add|i|ci|sync|remove|uninstall|require)$/.test(t[1] ?? '')) continue
    if (ehTeste(t)) return { trecho: trecho.replace(/^[({`\s]+/, '').replace(/[)}`\s]+$/, ''), motivo: 'teste' }
  }
  return null
}

/** Teste fora de `agent-pool test` e `orca orchestration worker-start` sem reserva são negados com o comando certo. */
export function decidir(e: Entrada): Decisao {
  const texto = e.comando.replace(/\r\n/g, '\n')
  const negado = acha(texto, e.reservaViva ?? true)
  return negado ? { permitir: false, ...negado } : { permitir: true }
}
