import { t } from './textos'

/** Texto do erro do worker: o `code` estável vira frase do idioma (+ o dado em `message`); sem tradução, vale a mensagem. */
export function textoErro(e: unknown): string {
  const x = e as { code?: string; message?: string }
  if (x.code === 'config_recusada') return codigosConfig(x.message ?? '')
  const base = x.code ? (t.erros as Record<string, string | undefined>)[x.code] : undefined
  return base ? (x.message ? `${base}: ${traduzirCodigos(x.message)}` : base) : traduzirCodigos(x.message ?? String(e))
}

/** Códigos que o worker embute na mensagem (`raiz_invalida`, `orca_saiu:2`…) viram frase do idioma; o resto segue cru. */
export function traduzirCodigos(s: string): string {
  return s.replace(/orca_saiu:(\d+)/g, (_, n: string) => t.orcaSaiu(n)).replace(/\b[a-z]+(?:_[a-z]+)+\b/g, c => t.codigosTexto[c] ?? c)
}

/** O worker manda erro de config como `chave: codigo; ...`; códigos conhecidos viram frase do idioma, o resto (erro de SO) segue cru. */
export function codigosConfig(s: string): string {
  return s
    .split('; ')
    .map(parte => {
      const m = /^(.+): (\w+)$/.exec(parte)
      return m && t.codigosConfig[m[2]] ? `${m[1]}: ${t.codigosConfig[m[2]]}` : parte
    })
    .join('; ')
}
