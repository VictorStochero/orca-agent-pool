import { acharAgente, CATALOGO } from '../../core/catalogo.ts'
import { carregar } from '../../core/config.ts'
import { medirTodas } from '../../core/medidas/cache.ts'
import { caminhoDeBusca } from '../../core/orca.ts'
import { escolherSegunda, rankearEscritores } from '../../core/pool/escolha.ts'
import { ramLivreGb } from '../../core/pool/memoria.ts'
import { ocupacaoViva, pegar, soltar } from '../../core/pool/vagas.ts'
import { type Ctx, caminhos, comJson, donoValido, emitir, SemVaga, Uso } from '../ctx.ts'
import { textoEscolha, textosPara } from '../textos.ts'

const FAMILIAS = [...new Set(CATALOGO.map(a => a.familia))].filter(f => f !== 'outro') as string[]

const medidas = async (ctx: Ctx, c: ReturnType<typeof carregar>) =>
  medirTodas(c, caminhos(ctx), ctx.orca, { home: ctx.home, fetch: ctx.fetch, agora: ctx.agora(), path: await caminhoDeBusca(ctx.env) })

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
  // Pedido repetido com a mesma tag: o agente que refaz a cadeia recebe a conta já reservada, sem segunda vaga.
  const reservada = tag ? (await ocupacaoViva(p, c, agora)).vivas.find(v => v.dono === `res-${tag}`)?.conta : undefined
  const rank = await rankearEscritores(c, await medidas(ctx, c), p, agora, reservada)
  const mantida = rank.some(r => r.conta === reservada)
  // A conta da reserva saiu do rank (cota, erro, desativada): solta a antiga para a nova escolha não deixar duas vagas do mesmo dono.
  if (tag && reservada && !mantida) await soltar(p, `res-${tag}`)
  const candidatas = mantida ? rank.filter(r => r.conta === reservada) : rank
  let motivo = t.nenhumaApta
  for (const r of candidatas) {
    if (!tag) {
      emitir(ctx, json, r, textoEscolha(ctx.env, r))
      return 0
    }
    const ram = c.pool.ramMinGb > 0 ? await ramLivreGb(ctx.orca) : null
    const res = await pegar(p, c, r.conta, `res-${tag}`, agora, ram)
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
  const r = await escolherSegunda(c, await medidas(ctx, c), familia, p, ctx.agora())
  if (!r) throw new SemVaga(t.semSegunda)
  emitir(ctx, json, r, textoEscolha(ctx.env, r))
  return 0
}
