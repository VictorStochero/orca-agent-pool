import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { vivoPadrao } from './fila/travas.ts'

/** Nomes das sessões interativas abertas da conta Claude, lidas de `<dir>/sessions/<pid>.json` (só exibição, não contam vaga). */
// shortcut: pid reaproveitado de arquivo que sobrou de travamento conta como sessão; conferir `procStart` se isso incomodar.
export function sessoesAbertas(dir: string, vivo: (pid: number) => boolean = vivoPadrao): string[] {
  let nomes: string[]
  try { nomes = readdirSync(join(dir, 'sessions')).filter((n) => n.endsWith('.json')) } catch { return [] }
  const abertas: string[] = []
  for (const n of nomes) {
    try {
      const s = JSON.parse(readFileSync(join(dir, 'sessions', n), 'utf8'))
      if (!Number.isInteger(s?.pid) || s.pid <= 0 || s.kind !== 'interactive' || !vivo(s.pid)) continue
      abertas.push(typeof s.name === 'string' && s.name ? s.name : String(s.pid))
    } catch { /* Arquivo ilegível: ignora. */ }
  }
  return abertas
}
