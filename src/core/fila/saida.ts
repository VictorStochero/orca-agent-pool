import { StringDecoder } from 'node:string_decoder'
import type { InfoTrava } from '../trava.ts'

/** `ts` é o epoch ms do último chunk recebido (stdout ou stderr). */
export type SaidaTeste = NonNullable<InfoTrava['saida']>

// biome-ignore lint/suspicious/noControlCharactersInRegex: o ESC é o que se quer remover
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const PHPUNIT = /(\d+)\s*\/\s*(\d+)\s*\(\s*(\d+)%\)\s*$/
const PYTEST = /\[\s*(\d+)%\]\s*$/
const MAX_LINHA = 200
// Linha feita só dos símbolos de progresso do PHPUnit/Pest compacto (com espaços).
const SIMBOLOS = /^[.⨯✓!sSEFIRWDN\s-]+$/
const PASSOU = new Set(['.', '✓', '✔'])
const FALHOU = new Set(['F', 'E', '⨯', '×', '✕', '✗'])

type Contagem = { passou: number; falhou: number; feitos: number }
const VAZIA: Contagem = { passou: 0, falhou: 0, feitos: 0 }

/** Conta os símbolos de um texto feito só deles; s S I R W D N ! - contam em feitos, mas nem passam nem falham. */
function contarSimbolos(texto: string): Contagem | null {
  const l = texto.replace(ANSI, '').trim()
  if (!l || !SIMBOLOS.test(l)) return null
  const c = { ...VAZIA }
  for (const ch of l.replace(/\s/g, '')) {
    c.feitos++
    if (PASSOU.has(ch)) c.passou++
    else if (FALHOU.has(ch)) c.falhou++
  }
  return c
}

/** Marca por teste no começo da linha (Pest/Collision, vitest/jest): ✓ ✔ passou; ⨯ × ✕ ✗ falhou. */
function contarMarca(linha: string): Contagem | null {
  const ch = [...linha][0]
  if (PASSOU.has(ch)) return { passou: 1, falhou: 0, feitos: 1 }
  return FALHOU.has(ch) ? { passou: 0, falhou: 1, feitos: 1 } : null
}

const somar = (a: Contagem, b: Contagem | null): Contagem =>
  b ? { passou: a.passou + b.passou, falhou: a.falhou + b.falhou, feitos: a.feitos + b.feitos } : a

/** Acumula a saída do teste (por stream, sem partir caractere multibyte) e extrai a última linha e o progresso. */
export function acompanharSaida(agora: () => number) {
  const decoders = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') }
  const resto = { out: '', err: '' }
  const s: SaidaTeste = { ts: 0, linha: null, linhas: 0, pct: null, feitos: null, total: null, passou: null, falhou: null }
  let acc = VAZIA
  let visto = false
  let totalListado: number | null = null

  const linha = (bruta: string) => {
    const l = bruta.replace(ANSI, '').trim()
    s.linhas++
    if (!l) return
    s.linha = l.slice(0, MAX_LINHA)
    const ph = PHPUNIT.exec(l)
    const py = PYTEST.exec(l)
    if (ph) {
      ;[s.feitos, s.total, s.pct] = [Number(ph[1]), Number(ph[2]), Number(ph[3])]
      acc = somar(acc, contarSimbolos(l.slice(0, ph.index)))
    } else if (py) s.pct = Number(py[1])
    else acc = somar(acc, contarSimbolos(l) ?? contarMarca(l))
    if (s.total === null && acc.feitos) s.feitos = acc.feitos
  }

  return {
    receber(fonte: 'out' | 'err', chunk: Buffer) {
      s.ts = agora()
      visto = true
      // \r\n vira uma quebra só; o \r final espera o próximo chunk para não contar duas vezes.
      const partes = (resto[fonte] + decoders[fonte].write(chunk)).split(/\r\n|\n|\r(?!$)/)
      resto[fonte] = partes.pop() ?? ''
      for (const p of partes) linha(p)
    },
    /** Total vindo da listagem dos testes; só vale quando a própria saída não traz total. */
    definirTotal(n: number) {
      totalListado = n
    },
    estado(): SaidaTeste | null {
      if (!visto && totalListado === null) return null
      // O compacto imprime os pontos na mesma linha, sem \n: o pedaço pendente só de símbolos conta (uma vez, até a linha fechar).
      const c = somar(somar(acc, contarSimbolos(resto.out)), contarSimbolos(resto.err))
      const r: SaidaTeste = {
        ...s,
        feitos: s.total === null && c.feitos ? c.feitos : s.feitos,
        passou: c.feitos ? c.passou : null,
        falhou: c.feitos ? c.falhou : null,
      }
      if (s.total === null && totalListado !== null) {
        r.total = totalListado
        r.feitos ??= 0
        // Travada em 99% enquanto roda: os feitos podem passar do total listado (data sets, testes dinâmicos).
        r.pct ??= Math.min(99, Math.floor((r.feitos * 100) / totalListado))
      }
      return r
    },
  }
}
