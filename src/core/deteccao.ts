import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { CATALOGO } from './catalogo.ts'
import type { Config, OrcaCli } from './tipos.ts'

export type Detectada = {
  nome: string
  agente: string
  rotulo: string
  /** Conta cadastrada no Orca (não a padrão): o despacho e a medida ainda usam a padrão. */
  gerenciada?: boolean
}

export function instalado(comando: string, pathEnv: string): boolean {
  const extensoes = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat', '.com'] : ['']
  return pathEnv
    .split(delimiter)
    .filter(Boolean)
    .some(dir =>
      extensoes.some(ext => {
        try {
          const caminho = join(dir.replace(/^"|"$/g, ''), comando + ext)
          accessSync(caminho, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
          return statSync(caminho).isFile()
        } catch {
          return false
        }
      }),
    )
}

export async function detectar(orca: OrcaCli, pathEnv: string): Promise<Detectada[]> {
  let dados: Record<
    string,
    { accounts?: { id?: string; label?: string }[]; systemDefault?: { hasAuth?: boolean; workspaceLabel?: string } }
  > = {}
  let claudeComCota = false
  try {
    const r = await orca.run(['account', 'list', '--json'])
    if (r.code === 0) {
      const json = JSON.parse(r.stdout)
      if (json.ok !== false) {
        dados = json.result ?? json
        const cota = (json.result ?? json).rateLimits?.claude
        claudeComCota =
          cota?.status === 'ok' && (typeof cota.session?.usedPercent === 'number' || typeof cota.weekly?.usedPercent === 'number')
      }
    }
  } catch {
    /* A detecção local continua se o Orca estiver indisponível. */
  }
  const achadas: Detectada[] = []
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64)
  for (const a of CATALOGO) {
    const prov = a.perfilGerenciadoDe ?? a.idOrca ?? a.id
    const contas = Array.isArray(dados[prov]?.accounts) ? dados[prov].accounts! : []
    if (a.perfilGerenciadoDe && contas.length === 0) continue
    if (!a.perfilGerenciadoDe) {
      for (const conta of contas) {
        if (typeof conta.id !== 'string' || !conta.id) continue
        achadas.push({ nome: slug(`${a.id}-${conta.id.slice(0, 8)}`), agente: a.id, rotulo: conta.label || conta.id, gerenciada: true })
      }
      const padrao = dados[prov]?.systemDefault
      if (padrao?.hasAuth || (a.id === 'claude' && claudeComCota))
        achadas.push({ nome: `${a.id}-padrao`, agente: a.id, rotulo: padrao?.workspaceLabel || a.id })
    }
    if ((a.perfilGerenciadoDe || !achadas.some(d => d.agente === a.id)) && a.comandos.some(comando => instalado(comando, pathEnv))) {
      achadas.push({ nome: a.id, agente: a.id, rotulo: a.id })
    }
  }
  return achadas
}

export function sincronizarDetectadas(c: Config, d: Detectada[]): Config {
  const contas = [...c.pool.contas]
  for (const detectada of d) {
    // Conta manual sem pasta nem comando próprios é a mesma do perfil padrão que o Orca detecta.
    const mesmaPadrao =
      !detectada.gerenciada &&
      contas.some(conta => conta.origem === 'manual' && conta.agente === detectada.agente && !conta.config && !conta.comando)
    if (mesmaPadrao || contas.some(conta => conta.nome === detectada.nome) || c.pool.ignoradas?.includes(detectada.nome)) continue
    const agente = CATALOGO.find(a => a.id === detectada.agente)
    if (!agente) continue
    // Entra desativada: só recebe trabalho (e gasta cota) depois que o usuário a ativa no painel.
    contas.push({
      nome: detectada.nome,
      agente: detectada.agente,
      config: null,
      comando: null,
      modelo: null,
      vagas: 1,
      peso: 1,
      papeis: detectada.gerenciada ? [] : [...agente.papeisPadrao],
      ativo: false,
      origem: 'orca',
    })
  }
  return { ...c, pool: { ...c.pool, contas } }
}
