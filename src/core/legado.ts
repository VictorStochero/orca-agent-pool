import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acharAgente } from './catalogo.ts'
import { PADRAO, validar } from './config.ts'
import type { Config, Conta, Papel } from './tipos.ts'

function ler(caminho: string): string | null {
  try {
    return readFileSync(caminho, 'utf8')
  } catch {
    return null
  }
}

const linhas = (t: string) => t.split('\n').map((l) => l.replace(/\r$/, ''))

function contaDe(nome: string, resto: string): Conta {
  const kv: Record<string, string> = {}
  for (const m of resto.matchAll(/([a-z_]+)=("[^"]*"|\S*)/g)) kv[m[1]] = m[2].replace(/^"|"$/g, '')
  const agente = kv.agente ?? ''
  return {
    nome,
    agente,
    config: kv.config || null,
    comando: kv.comando || null,
    modelo: null,
    vagas: kv.vagas !== undefined ? Number(kv.vagas) : 1,
    peso: kv.peso !== undefined ? Number(kv.peso) : 1,
    papeis: (kv.papeis !== undefined ? (kv.papeis ? kv.papeis.split(',') : []) : (acharAgente(agente)?.papeisPadrao ?? [])) as Papel[],
    ativo: kv.ativo !== 'nao',
    origem: 'manual'
  }
}

/** Config a partir de ~/.claude/agentes.conf e fila.conf; null se nenhum existir. Não altera os originais. */
export function importarLegado(home: string): Config | null {
  const agentes = ler(join(home, '.claude', 'agentes.conf'))
  const fila = ler(join(home, '.claude', 'fila.conf'))
  if (agentes === null && fila === null) return null
  const c = structuredClone(PADRAO)
  const vagasLegadas: Record<string, number> = {}
  for (const l of linhas(agentes ?? '')) {
    if (/^\s*(#|$)/.test(l)) continue
    let m: RegExpExecArray | null
    if ((m = /^\s*escolha=(ritmo|ordem)\s*$/.exec(l))) c.pool.escolha = m[1] as 'ritmo' | 'ordem'
    else if ((m = /^\s*teto=([0-9]+)\s*$/.exec(l))) c.pool.teto = Number(m[1])
    else if ((m = /^\s*ram_min=([0-9]+(?:\.[0-9]+)?)\s*$/.exec(l))) c.pool.ramMinGb = Number(m[1])
    else if ((m = /^\s*([a-z0-9_-]+)=([0-9]+)\s*$/.exec(l))) vagasLegadas[m[1]] = Number(m[2])
    else if ((m = /^\s*([a-z0-9_-]+)\s+(\S.*)$/.exec(l))) c.pool.contas.push(contaDe(m[1], m[2]))
  }
  for (const x of c.pool.contas) if (x.nome in vagasLegadas) x.vagas = vagasLegadas[x.nome]
  // Linha inválida é ignorada: uma conta fora das regras da config não pode impedir a primeira gravação.
  const vistas = new Set<string>()
  c.pool.contas = c.pool.contas.filter((x) => {
    if (vistas.has(x.nome) || validar({ ...c, pool: { ...c.pool, contas: [x] } }).some((e) => e.chave.startsWith('conta.'))) return false
    vistas.add(x.nome)
    return true
  })
  const campos: Record<string, (v: string) => void> = {
    FILA_TESTE_FILA: (v) => {
      const modo = v === 'recurso' ? 'banco' : v
      if (modo === 'global' || modo === 'banco' || modo === 'projeto') c.fila.modo = modo
    },
    FILA_TESTE_VAGAS: (v) => (c.fila.vagas = Number(v)),
    FILA_TESTE_VAGAS_PROJETO: (v) => (c.fila.vagasPorProjeto = Number(v)),
    FILA_TESTE_TETO: (v) => (c.fila.teto = Number(v)),
    FILA_TESTE_PROCESSOS: (v) => (c.fila.processos = Number(v))
  }
  for (const l of linhas(fila ?? '')) {
    const m = /^\s*(FILA_TESTE_[A-Z_]+)=(\S*)\s*$/.exec(l)
    if (!m || !(m[1] in campos)) continue
    // Modo é uma das palavras; o resto, inteiro >= 1; linha inválida é ignorada.
    if (m[1] === 'FILA_TESTE_FILA' || /^[1-9][0-9]*$/.test(m[2])) campos[m[1]](m[2])
  }
  return c
}
