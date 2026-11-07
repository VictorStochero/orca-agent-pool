import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acharAgente } from './catalogo.ts'
import { caracteresValidos, ErroConfig, PADRAO, validar } from './config.ts'
import { aplicar } from './config-chaves.ts'
import type { Config, Conta, Papel } from './tipos.ts'

function ler(caminho: string): string | null {
  try {
    return readFileSync(caminho, 'utf8')
  } catch {
    return null
  }
}

const linhas = (t: string) => t.split('\n').map(l => l.replace(/\r$/, ''))

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
    origem: 'manual',
  }
}

/** Config a partir de ~/.claude/agentes.conf e fila.conf; null se nenhum existir. Não altera os originais. */
export function importarLegado(home: string): Config | null {
  const agentes = ler(join(home, '.claude', 'agentes.conf'))
  const fila = ler(join(home, '.claude', 'fila.conf'))
  if (agentes === null && fila === null) return null
  let c = structuredClone(PADRAO)
  const vagasLegadas: Record<string, number> = {}
  const chaves: Record<string, string> = {}
  // A primeira regra que casa vale.
  const regras: [RegExp, (m: RegExpExecArray) => void][] = [
    [
      /^\s*(escolha|teto|ram_min)=(\S+)\s*$/,
      m => {
        chaves[`pool.${m[1]}`] = m[2]
      },
    ],
    [
      /^\s*([a-z0-9_-]+)=([0-9]+)\s*$/,
      m => {
        vagasLegadas[m[1]] = Number(m[2])
      },
    ],
    [/^\s*([a-z0-9_-]+)\s+(\S.*)$/, m => c.pool.contas.push(contaDe(m[1], m[2]))],
  ]
  for (const l of linhas(agentes ?? '')) {
    if (/^\s*(#|$)/.test(l)) continue
    for (const [re, acao] of regras) {
      const m = re.exec(l)
      if (m) {
        acao(m)
        break
      }
    }
  }
  for (const x of c.pool.contas) if (x.nome in vagasLegadas) x.vagas = vagasLegadas[x.nome]
  // Linha inválida é ignorada: uma conta fora das regras da config não pode impedir a primeira gravação.
  const vistas = new Set<string>()
  c.pool.contas = c.pool.contas.filter(x => {
    const invalida =
      !caracteresValidos('config', x.config ?? '') ||
      !caracteresValidos('comando', x.comando ?? '') ||
      validar({ ...c, pool: { ...c.pool, contas: [x] } }).some(e => e.chave.startsWith('conta.'))
    if (vistas.has(x.nome) || invalida) return false
    vistas.add(x.nome)
    return true
  })
  const chavesDaFila: Record<string, string> = {
    FILA_TESTE_FILA: 'fila.modo',
    FILA_TESTE_VAGAS: 'fila.vagas',
    FILA_TESTE_VAGAS_PROJETO: 'fila.vagas_projeto',
    FILA_TESTE_TETO: 'fila.teto',
    FILA_TESTE_PROCESSOS: 'fila.processos',
  }
  for (const l of linhas(fila ?? '')) {
    const m = /^\s*(FILA_TESTE_[A-Z_]+)=(\S*)\s*$/.exec(l)
    if (m && m[1] in chavesDaFila) chaves[chavesDaFila[m[1]]] = m[2]
  }
  // Valor fora da faixa é ignorado, um por um: o legado inválido não pode impedir a primeira gravação.
  for (const [chave, valor] of Object.entries(chaves)) {
    try {
      c = aplicar(c, { [chave]: valor })
    } catch (erro) {
      if (!(erro instanceof ErroConfig)) throw erro
    }
  }
  return c
}
