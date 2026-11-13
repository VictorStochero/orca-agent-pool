// Estado compartilhado entre as seções: átomos lidos por mais de uma delas e as ações que os gravam.
import { atom, plugin, read, set, update } from 'orca'
import type { Estado, EstadoHookAgente, Requisitos } from '../protocol'
import { textoErro } from './erros'
import { t } from './textos'

type Erro = { code: string; message: string }
type Aviso = { tom: 'success' | 'danger'; texto: string }

export const estado = atom<Estado | null>(null)
/** null enquanto não lido ou quando o worker não tem o handler (painel normal). */
export const requisitos = atom<Requisitos | null>(null)
/** Aviso verde da instalação que completou tudo; some na próxima atualização. */
export const concluido = atom(false)
/** A releitura dos requisitos veio vazia ou inválida; `Mensagem` mostra a frase no idioma atual. */
export const releituraFalhou = atom(false)
export const erro = atom<Erro | null>(null)
export const carregando = atom(false)
export const medindo = atom(false)
/** Edições pendentes por chave de configuração (ex.: `conta.main.vagas`). */
export const edicoes = atom<Record<string, string>>({})
export const avisos = atom<Record<string, Aviso>>({})
export const gravando = atom<string | null>(null)
export const hooks = atom<EstadoHookAgente[]>([])
export const erroHooks = atom(false)

/** Coleta em andamento e o pedido de repeti-la ao fim (set() é em lote: nenhum átomo serve de guarda). */
let emCurso: Promise<void> | null = null
let repeticao: { forcar: boolean } | null = null

export const mudar = (chave: string, valor: string) => update(edicoes, p => ({ ...p, [chave]: valor }))

export const avisar = (secao: string, a: Aviso) => update(avisos, p => ({ ...p, [secao]: a }))

/** Tira as edições das `chaves` e o aviso da seção (o erro de uma gravação recusada não vale mais). */
export function descartar(secao: string, chaves: string[]): void {
  update(edicoes, p => Object.fromEntries(Object.entries(p).filter(([c]) => !chaves.includes(c))))
  update(avisos, p => Object.fromEntries(Object.entries(p).filter(([s]) => s !== secao)))
}

export const ehRequisitos = (x: unknown): x is Requisitos =>
  typeof (x as Requisitos | null)?.ok === 'boolean' && Array.isArray((x as Requisitos).itens)

/** Já houve uma pendência: só uma leitura válida "tudo instalado" tira o painel da tela de pendências. */
export const pendente = () => {
  const r = read(requisitos)
  return r !== null && !r.ok
}

/** null: worker sem o handler `requisitos.ler` (versão antiga) ou resposta fora do formato. */
export async function lerRequisitos(forcar = false): Promise<Requisitos | null> {
  try {
    const r: unknown = await (forcar ? plugin.request('requisitos.ler', { forcar: true }) : plugin.request('requisitos.ler'))
    return ehRequisitos(r) ? r : null
  } catch (e) {
    if ((e as { code?: string }).code === 'unknown_method') return null
    throw e
  }
}

export async function lerHooks(): Promise<void> {
  try {
    set(hooks, await plugin.request('hooks.estado'))
    set(erroHooks, false)
  } catch {
    set(erroHooks, true)
  }
}

/** Aplica uma releitura dos requisitos; true = o painel fica na tela de pendências. */
export function aplicarLeitura(r: Requisitos | null): boolean {
  if (r) set(requisitos, r)
  const pendencia = r ? !r.ok : pendente()
  // Leitura vazia ou inválida depois de uma pendência não tira o painel da lista.
  set(releituraFalhou, !r && pendencia)
  return pendencia
}

function tomarRepeticao() {
  const r = repeticao
  repeticao = null
  return r
}

/** Com coleta em andamento, a chamada pede uma repetição ao fim e espera a mesma promessa: a releitura pós-ação nunca se perde. */
export function atualizar(forcar = false): Promise<void> {
  if (emCurso) {
    repeticao = { forcar: forcar || (repeticao?.forcar ?? false) }
    return emCurso
  }
  emCurso = (async () => {
    try {
      let proxima: { forcar: boolean } | null = { forcar }
      while (proxima) {
        await coletar(proxima.forcar)
        proxima = tomarRepeticao()
      }
    } finally {
      emCurso = null
    }
  })()
  return emCurso
}

async function coletar(forcar: boolean): Promise<void> {
  set(carregando, true)
  set(concluido, false)
  try {
    const ficaNaLista = aplicarLeitura(await lerRequisitos(forcar))
    await lerHooks()
    if (ficaNaLista) return set(erro, null) // faltou requisito: só a seção Requisitos, sem coletar o resto
    set(estado, await plugin.request('estado.ler'))
    set(erro, null)
  } catch (e) {
    falhou(e)
  } finally {
    set(carregando, false)
  }
}

function falhou(e: unknown) {
  const x = e as { code?: string; message?: string }
  set(erro, { code: x.code ?? 'erro', message: x.message ?? String(e) })
}

/** Mede as cotas agora, sem o cache do worker. */
// shortcut: as contas são medidas uma por vez, até ~110 s cada pelo `claude /usage`; passando do teto de 120 s do pedido, o worker segue e o resultado chega pelo `estado.mudou`. Se isso virar regra, o pedido só dispara a medição.
export async function medirCotas(): Promise<void> {
  set(medindo, true)
  try {
    set(estado, await plugin.request('cotas.medir', undefined, { timeoutMs: 120_000 }))
    set(erro, null)
  } catch (e) {
    if ((e as { code?: string }).code !== 'timeout') falhou(e)
  } finally {
    set(medindo, false)
  }
}

/** Grava as edições das `chaves` da seção (mais os `extras`); a recusa do validador volta como mensagem da seção. */
export async function salvar(secao: string, chaves: string[], extras: Record<string, string> = {}): Promise<boolean> {
  const todas = read(edicoes)
  const valores: Record<string, string> = { ...extras }
  for (const c of chaves) if (c in todas) valores[c] = todas[c]
  set(gravando, secao)
  try {
    set(estado, await plugin.request('config.gravar', { valores }))
    update(edicoes, p => Object.fromEntries(Object.entries(p).filter(([c]) => !(c in valores))))
    avisar(secao, { tom: 'success', texto: t.salvo })
    return true
  } catch (e) {
    avisar(secao, { tom: 'danger', texto: textoErro(e) })
    return false
  } finally {
    set(gravando, null)
  }
}
