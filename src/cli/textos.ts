import type { ErroValidacao } from '../core/config.ts'
import type { EventoFila } from '../core/fila/rodar.ts'
import type { Escolhida } from '../core/pool/escolha.ts'

type Palavras = { sem: string; ritmo: string; livre: string; zera: string; peso: string }
function descreverEscolha(e: Escolhida, w: Palavras): string {
  const zera = e.horas === null ? '' : `, ${w.zera} ${Math.round(e.horas)}h`
  const peso = e.peso === 1 ? '' : ` · ${w.peso} ${e.peso}`
  if (e.semMedidor) return `${e.conta} (${w.sem})${peso}`
  if (e.ritmo === null) return `${e.conta} (${e.livre}% ${w.livre}${zera})`
  return `${e.conta} (${w.ritmo} ${e.ritmo.toFixed(1)} · ${e.livre}% ${w.livre}${zera})${peso}`
}

const pt = {
  ajuda: `uso: agent-pool <comando>
  test [-- comando]                         roda o teste pela fila
  writer [--reserve <tag>]                  escolhe o escritor (e reserva a vaga)
  second --family <família>                 escolhe a segunda opinião
  slot take <conta> <dono> | swap <prov> <dispatch> | release <dispatch> | free
  status [--json]   config get|set …   measure [conta]   doctor   hook <claude|codex>
códigos: 0 ok, 2 uso inválido, 75 sem vaga ou espera esgotada`,
  uso: 'uso', vazio: '(vazio)', comando: 'comando', chave: 'chave', valor: 'valor',
  erro: 'erro', semanal: 'semanal', semLogin: 'sem login', semMedida: 'sem medida',
  inativa: 'inativa', nenhumaConta: 'nenhuma conta',
  fila: 'fila', rodando: 'rodando', aguardando: 'aguardando', parados: 'parados',
  modos: { banco: 'banco', projeto: 'projeto', global: 'global', ritmo: 'ritmo', ordem: 'ordem' } as Record<string, string>,
  emUso: 'em uso', livresRotulo: 'livres',
  reserva: 'reserva', liberada: 'liberada', falta: 'falta', lancador: 'lançador', contas: 'conta(s)',
  alteracoes: 'alteração(ões)',
  chaveDesconhecida: 'chave desconhecida', contaDesconhecida: 'conta desconhecida',
  esperavaPar: 'esperava chave=valor, veio',
  nomeInvalido: (s: string) => `nome inválido: ${s} (use letras, números, _ e -)`,
  semVaga: 'sem vaga', travaOcupada: 'reserva da máquina em andamento, espere e tente de novo', nenhumaApta: 'nenhuma conta apta (cota, vaga, login ou papel)',
  poucaMemoria: 'memória livre abaixo do mínimo',
  semSegunda: 'sem segunda opinião apta (outra família, cota abaixo de 60%)',
  reservaAusente: (s: string) => `reserva ${s} não existe (expirou?)`,
  motivos: { memoria: 'memória insuficiente', cheio: 'limite de vagas atingido', inativa: 'conta inativa' } as Record<string, string>,
  errosHook: { raiz_invalida: 'raiz não é um objeto', hooks_invalido: '"hooks" inválido', pretooluse_invalido: '"hooks.PreToolUse" inválido' } as Record<string, string>,
  config: {
    valor_invalido: 'valor inválido', config_invalida: 'configuração inválida', versao_nao_suportada: 'versão não suportada',
    ilegivel: 'não consegui ler a configuração', json_invalido: 'a configuração não é JSON válido',
    conta_existente: 'conta já existe', conta_inexistente: 'conta inexistente', conta_repetida: 'conta repetida',
    ordem_incompleta: 'ordem incompleta', chave_desconhecida: 'chave desconhecida',
    agente_desconhecido: 'agente desconhecido', variavel_sem_suporte: 'variável sem suporte',
    agente_nao_provado: 'agente sem imposição comprovada', config_ocupada: 'outra gravação da configuração em andamento'
  } as Record<string, string>,
  stackAusente: 'Stack não detectada: use agent-pool test -- <comando de teste>',
  escolha: (e: Escolhida) => descreverEscolha(e, { sem: 'sem medidor', ritmo: 'ritmo', livre: 'livre', zera: 'zera em', peso: 'peso' }),
  avisoFila: (ev: EventoFila) =>
    ev.codigo === 'aguardando' ? `Aguardando fila ${ev.fila}`
      : ev.codigo === 'ocupada' ? `FILA OCUPADA — ${ev.fila} — rode de novo`
        : ev.codigo === 'sem_stack' ? 'Stack não detectada: use agent-pool test -- <comando de teste>'
          : `Não foi possível iniciar ${ev.comando}: ${ev.erro}`,
  hookNegado: (lancador: string, trecho: string, prefixo = '') =>
    `Execute o trecho de teste pela fila: troque \`${trecho}\` por \`${prefixo}"${lancador}" test -- ${trecho}\` (se sair 75, espere e rode de novo).`
}

type Textos = { [K in keyof typeof pt]: (typeof pt)[K] }
const en: Textos = {
  ajuda: `usage: agent-pool <command>
  test [-- command]                        run tests through the queue
  writer [--reserve <tag>]                  choose a writer (and reserve a slot)
  second --family <family>                 choose a second opinion
  slot take <account> <owner> | swap <reservation> <dispatch> | release <dispatch> | free
  status [--json]   config get|set …   measure [account]   doctor   hook <claude|codex>
exit codes: 0 ok, 2 invalid usage, 75 no slot or wait timed out`,
  uso: 'usage', vazio: '(empty)', comando: 'command', chave: 'key', valor: 'value',
  erro: 'error', semanal: 'weekly', semLogin: 'not logged in', semMedida: 'not measured',
  inativa: 'inactive', nenhumaConta: 'no accounts',
  fila: 'queue', rodando: 'running', aguardando: 'waiting', parados: 'stopped',
  modos: { banco: 'database', projeto: 'project', global: 'global', ritmo: 'pace', ordem: 'order' },
  emUso: 'in use', livresRotulo: 'free',
  reserva: 'reserve', liberada: 'released', falta: 'missing', lancador: 'launcher', contas: 'account(s)',
  alteracoes: 'change(s)',
  chaveDesconhecida: 'unknown key', contaDesconhecida: 'unknown account',
  esperavaPar: 'expected key=value, got',
  nomeInvalido: (s) => `invalid name: ${s} (use letters, numbers, _ and -)`,
  semVaga: 'no slot', travaOcupada: 'machine reservation in progress, wait and try again', nenhumaApta: 'no eligible account (quota, slot, login or role)',
  poucaMemoria: 'free memory below the minimum',
  semSegunda: 'no eligible second opinion (another family, quota below 60%)',
  reservaAusente: (s) => `reservation ${s} does not exist (expired?)`,
  motivos: { memoria: 'insufficient memory', cheio: 'slot limit reached', inativa: 'inactive account' },
  errosHook: { raiz_invalida: 'root is not an object', hooks_invalido: '"hooks" is invalid', pretooluse_invalido: '"hooks.PreToolUse" is invalid' },
  config: {
    valor_invalido: 'invalid value', config_invalida: 'invalid configuration', versao_nao_suportada: 'unsupported version',
    ilegivel: 'could not read configuration', json_invalido: 'configuration is not valid JSON',
    conta_existente: 'account already exists', conta_inexistente: 'account does not exist', conta_repetida: 'duplicate account',
    ordem_incompleta: 'incomplete order', chave_desconhecida: 'unknown key',
    agente_desconhecido: 'unknown agent', variavel_sem_suporte: 'unsupported variable',
    agente_nao_provado: 'agent has no proven enforcement', config_ocupada: 'another configuration write is in progress'
  },
  stackAusente: 'Stack not detected: use agent-pool test -- <test command>',
  escolha: (e) => descreverEscolha(e, { sem: 'no meter', ritmo: 'pace', livre: 'free', zera: 'resets in', peso: 'weight' }),
  avisoFila: (ev) =>
    ev.codigo === 'aguardando' ? `Waiting for queue ${ev.fila}`
      : ev.codigo === 'ocupada' ? `QUEUE BUSY — ${ev.fila} — run again`
        : ev.codigo === 'sem_stack' ? 'Stack not detected: use agent-pool test -- <test command>'
          : `Could not start ${ev.comando}: ${ev.erro}`,
  hookNegado: (lancador, trecho, prefixo = '') =>
    `Run the test part through the queue: replace \`${trecho}\` with \`${prefixo}"${lancador}" test -- ${trecho}\` (if it exits 75, wait and run again).`
}

export const textos = { en, pt }
export const textosPara = (env: NodeJS.ProcessEnv): Textos =>
  (env.LC_ALL || env.LANG || '').toLowerCase().startsWith('pt') ? pt : en

/** Ocupação de uma conta com rótulo: "1/3 em uso" (status) ou "2/3 livres" (slot free). */
export function ocupacao(env: NodeJS.ProcessEnv, l: { total: number; livres: number; ocupadas: number }, qual: 'emUso' | 'livres'): string {
  const t = textosPara(env)
  if (l.total === 0) return `${l.ocupadas}/∞ ${t.emUso}` // sem limite: só a ocupação conta
  return qual === 'emUso' ? `${l.total - l.livres}/${l.total} ${t.emUso}` : `${l.livres}/${l.total} ${t.livresRotulo}`
}

export const erroConfig = (env: NodeJS.ProcessEnv, erros: ErroValidacao[]): string => {
  const t = textosPara(env)
  return erros.map((e) => `${e.chave}: ${t.config[e.codigo] ?? e.codigo}`).join('; ')
}

export const textoEscolha = (env: NodeJS.ProcessEnv, escolha: Escolhida): string => textosPara(env).escolha(escolha)
