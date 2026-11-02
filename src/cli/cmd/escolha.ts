import { acharAgente, CATALOGO } from '../../core/catalogo.ts'
import { carregar } from '../../core/config.ts'
import { escolherSegunda, rankearEscritores } from '../../core/pool/escolha.ts'
import { ramLivreGb } from '../../core/pool/memoria.ts'
import { pegar } from '../../core/pool/vagas.ts'
import { medirTodas } from '../../core/medidas/cache.ts'
import { caminhos, comJson, donoValido, emitir, SemVaga, Uso, type Ctx } from '../ctx.ts'
import { textoEscolha, textosPara } from '../textos.ts'

const FAMILIAS = [...new Set(CATALOGO.map((a) => a.familia))].filter((f) => f !== 'outro') as string[]

const medidas = (ctx: Ctx, c: ReturnType<typeof carregar>) =>
  medirTodas(c, caminhos(ctx), ctx.orca, { home: ctx.home, fetch: ctx.fetch, agora: ctx.agora() })

function valorDe(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

/** agent-pool writer [--reserve <tag>] */
export async function writer(ctx: Ctx, args: string[]): Promise<number> {
  const t = textosPara(ctx.env)
  const { json, resto } = comJson(args)
  const tag = resto.includes('--reserve') ? donoValido(ctx, valorDe(resto, '--reserve')) : null
  const p = caminhos(ctx)
  const c = carregar(p)
  const agora = ctx.agora()
  const rank = rankearEscritores(c, await medidas(ctx, c), p, agora)
  let motivo = t.nenhumaApta
  for (const r of rank) {
    if (!tag) {
      emitir(ctx, json, r, textoEscolha(ctx.env, r))
      return 0
    }
    const ram = c.pool.ramMinGb > 0 ? await ramLivreGb(ctx.orca) : null
    const res = pegar(p, c, r.conta, `res-${tag}`, agora, ram)
    if (res === 'ok') {
      emitir(ctx, json, { ...r, dono: `res-${tag}` }, `${textoEscolha(ctx.env, r)} · ${t.reserva} res-${tag}`)
      return 0
    }
    if (res === 'memoria') {
      motivo = t.poucaMemoria
      break
    }
  }
  throw new SemVaga(`${t.semVaga}: ${motivo}`)
}

/** agent-pool second --family <família> */
export async function second(ctx: Ctx, args: string[]): Promise<number> {
  const t = textosPara(ctx.env)
  const { json, resto } = comJson(args)
  const pedida = valorDe(resto, '--family')?.toLowerCase()
  // Aceita o id de um agente (codex → gpt); família fora do catálogo daria "outra família" falsa.
  const familia = pedida && (acharAgente(pedida)?.familia ?? pedida)
  if (!familia || !FAMILIAS.includes(familia)) throw new Uso(`${t.uso}: agent-pool second --family <claude|gpt|gemini>`)
  const p = caminhos(ctx)
  const c = carregar(p)
  const r = escolherSegunda(c, await medidas(ctx, c), familia, ctx.agora(), 60, p)
  if (!r) throw new SemVaga(t.semSegunda)
  emitir(ctx, json, r, textoEscolha(ctx.env, r))
  return 0
}
