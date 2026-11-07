import { join } from 'node:path'
import type { Paths } from '../paths.ts'
import { type Filho, lerInfo, pastas } from '../trava.ts'
import { CachePrazo, consultarProcessos } from '../win32.ts'

const JANELA_ANTES_MS = 5_000
const JANELA_DEPOIS_MS = 60_000
const CACHE_ORFAO_MS = 15_000
const SAIDA_ORFAO = '[DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()'
/** Por `pid:inicio` do filho: segue algum processo dele vivo? */
const cacheOrfao = new CachePrazo<boolean>()
const chaveOrfao = (f: Filho) => `${f.pid}:${f.inicio}`

/**
 * Filtro WQL do filho e de quem ele lançou; null fora do Windows ou com filho inválido
 * (o arquivo da trava não é confiável e o pid vai para dentro de um comando).
 */
function filtroOrfao(f: Filho): string | null {
  if (process.platform !== 'win32' || !Number.isInteger(f.pid) || f.pid <= 0 || !Number.isFinite(f.inicio)) return null
  return `(ProcessId=${f.pid} OR ParentProcessId=${f.pid}) AND Name<>'conhost.exe'`
}

/** Guarda e devolve o veredito a partir das horas de criação (`null` = a consulta falhou). */
function veredito(f: Filho, criacoes: string[] | null, agora: number): boolean {
  const vivo = criacoes?.some(l => Number(l) >= f.inicio - JANELA_ANTES_MS && Number(l) <= f.inicio + JANELA_DEPOIS_MS) ?? false
  // Morto com a janela já fechada não volta (processo novo cai fora dela): guarda sem prazo; falha da consulta não é final.
  const final = criacoes !== null && !vivo && agora > f.inicio + JANELA_DEPOIS_MS
  cacheOrfao.guardar(chaveOrfao(f), vivo, final ? Infinity : agora + CACHE_ORFAO_MS)
  return vivo
}

/** No Windows, o filho (ou um processo lançado por ele até 60 s depois) ainda vive? A janela de hora descarta pid reaproveitado. */
export async function orfaoVivo(f: Filho): Promise<boolean> {
  const filtro = filtroOrfao(f)
  if (!filtro) return false
  const agora = Date.now()
  return cacheOrfao.obter(chaveOrfao(f), agora) ?? veredito(f, await consultarProcessos(filtro, SAIDA_ORFAO), agora)
}

/**
 * Só o que já está em cache: depois de `aquecerOrfaos`, a leitura síncrona das travas não consulta.
 * Filho válido que ainda não foi consultado (o dono morreu depois do aquecimento) conta como vivo; o ciclo seguinte decide.
 */
export const orfaoEmCache = (f: Filho): boolean => (filtroOrfao(f) ? (cacheOrfao.obter(chaveOrfao(f), Date.now()) ?? true) : false)

/** Consulta, em paralelo, os filhos das travas de dono morto: a leitura síncrona seguinte os acha em cache. */
export async function aquecerOrfaos(p: Paths, vivo: (pid: number) => boolean): Promise<void> {
  const filhos: Filho[] = []
  for (const fila of pastas(p.fila)) {
    for (const vaga of pastas(join(p.fila, fila))) {
      const info = lerInfo(join(p.fila, fila, vaga))
      if (info?.pid !== undefined && info.filho && !vivo(info.pid)) filhos.push(info.filho)
    }
  }
  await Promise.all(filhos.map(orfaoVivo))
}
