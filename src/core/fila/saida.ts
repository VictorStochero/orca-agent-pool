import { StringDecoder } from 'node:string_decoder'
import type { InfoTrava } from '../trava.ts'

/** `ts` é o epoch ms do último chunk recebido (stdout ou stderr). */
export type SaidaTeste = NonNullable<InfoTrava['saida']>

// biome-ignore lint/suspicious/noControlCharactersInRegex: o ESC é o que se quer remover
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const PHPUNIT = /(\d+)\s*\/\s*(\d+)\s*\(\s*(\d+)%\)\s*$/
const PYTEST = /\[\s*(\d+)%\]\s*$/
const MARCA = /^[✓⨯×✕✔✗]/
const MAX_LINHA = 200

/** Acumula a saída do teste (por stream, sem partir caractere multibyte) e extrai a última linha e o progresso. */
export function acompanharSaida(agora: () => number) {
  const decoders = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') }
  const resto = { out: '', err: '' }
  const s: SaidaTeste = { ts: 0, linha: null, linhas: 0, pct: null, feitos: null, total: null }
  let marcas = 0
  let visto = false

  const linha = (bruta: string) => {
    const l = bruta.replace(ANSI, '').trim()
    s.linhas++
    if (!l) return
    s.linha = l.slice(0, MAX_LINHA)
    const ph = PHPUNIT.exec(l)
    const py = PYTEST.exec(l)
    if (ph) [s.feitos, s.total, s.pct] = [Number(ph[1]), Number(ph[2]), Number(ph[3])]
    else if (py) s.pct = Number(py[1])
    else if (MARCA.test(l)) marcas++
    if (s.total === null && marcas) s.feitos = marcas
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
    estado: (): SaidaTeste | null => (visto ? { ...s } : null),
  }
}
