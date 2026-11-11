// Requisitos de instalação (tela de pendências e Configurações > Instalação) e a desinstalação.
import { atom, Button, Collapsible, plugin, Row, read, Stack, set, Text, update } from 'orca'
import type { DetalheRequisito, IdInstalavel, RequisitoItem, Requisitos } from '../protocol'
import { Arquivos, Mensagem, Secao } from './comum'
import { textoErro, traduzirCodigos } from './erros'
import {
  aplicarLeitura,
  atualizar,
  avisar,
  concluido,
  ehRequisitos,
  gravando,
  lerHooks,
  lerRequisitos,
  pendente,
  releituraFalhou,
  requisitos,
} from './estado'
import { t } from './textos'

/** Requisitos com a linha aberta (o usuário abre para ver o que cada um faz antes de instalar). */
const abertosReq = atom<string[]>([])
/** Desinstalar armado: o segundo clique remove tudo. */
const confirmandoDesinstalar = atom(false)

async function instalarRequisito(id: IdInstalavel): Promise<void> {
  const veioDePendencia = pendente()
  set(gravando, `req:${id}`)
  try {
    const r: unknown = await plugin.request('requisitos.instalar', { id }) // devolve os requisitos já lidos de novo
    if (!ehRequisitos(r)) throw new Error(t.requisitos.respostaInvalida)
    set(requisitos, r)
    avisar('requisitos', { tom: 'success', texto: t.salvo })
  } catch (e) {
    avisar('requisitos', { tom: 'danger', texto: textoErro(e) })
  } finally {
    set(gravando, null)
  }
  await atualizar(true)
  if (veioDePendencia && read(requisitos)?.ok === true) set(concluido, true)
}

/** Refaz a checagem na hora (o worker guarda a leitura por 60 s). */
async function verificarAgora(): Promise<void> {
  set(gravando, 'req:verificar')
  try {
    const r = await lerRequisitos(true)
    // Leitura forçada vazia ou fora do formato: avisa, em vez de deixar a tabela anterior como se tivesse sido conferida.
    aplicarLeitura(r)
    if (!r) set(releituraFalhou, true)
    await lerHooks() // a tela de pendências e a aba Hooks mostram o mesmo estado que a checagem acabou de ler
  } catch (e) {
    avisar('requisitos', { tom: 'danger', texto: textoErro(e) })
  } finally {
    set(gravando, null)
  }
}

async function desinstalar(): Promise<void> {
  set(gravando, 'desinstalar')
  try {
    await plugin.request('desinstalar')
    avisar('desinstalar', { tom: 'success', texto: t.desinstalar.feito })
  } catch (e) {
    avisar('desinstalar', { tom: 'danger', texto: textoErro(e) })
  } finally {
    set(confirmandoDesinstalar, false)
    set(gravando, null)
  }
  await atualizar(true)
}

function textoDetalhe(d: DetalheRequisito): string {
  const x = t.requisitos.detalhe
  switch (d.codigo) {
    case 'nao_verificado':
    case 'versao':
    case 'versao_antiga':
      return x[d.codigo](traduzirCodigos(d.valor))
    case 'hooks':
      return d.agentes
        .map(a => `${a.agente}: ${a.situacao === 'erro' && a.erro ? traduzirCodigos(a.erro) : x.situacoes[a.situacao]}`)
        .join('; ')
    case 'instalado':
      return d.valor ?? x.instalado
    default:
      return x[d.codigo]
  }
}

/**
 * Um requisito por linha recolhível: o título traz ✓/✗, e aberta mostra o que faz, por que é obrigatório, a situação e o que o clique grava.
 * O botão Instalar só aparece dentro da linha aberta: o usuário consente vendo o que vai acontecer.
 */
function ItemRequisito({ i }: { i: RequisitoItem }) {
  const x = t.requisitos
  return (
    <Collapsible
      title={`${i.ok ? '✓' : '✗'} ${x.nomes[i.id]}`}
      description={`${x.obrigatorio} · ${i.ok ? x.instalado : x.falta} · ${x.abrir}`}
      open={read(abertosReq).includes(i.id)}
      onChange={aberto => update(abertosReq, l => (aberto ? [...l, i.id] : l.filter(k => k !== i.id)))}
    >
      <Stack gap="sm">
        <Text size="sm">{x.oQueFaz[i.id]}</Text>
        <Text size="sm" muted>
          {x.porque[i.id]}
        </Text>
        <Text size="sm">{`${x.situacao}: ${textoDetalhe(i.detalhe)}`}</Text>
        {i.instalar && i.id === 'orchestration' ? <Text size="sm">{x.instalaOrca}</Text> : null}
        {i.instalar && i.arquivos?.length ? <Arquivos titulo={x.vaiGravar} lista={i.arquivos} /> : null}
        {i.instalar && i.id !== 'orca' ? (
          <Button
            size="sm"
            icon="download"
            disabled={read(gravando) !== null}
            onPress={() => {
              if (i.id !== 'orca') void instalarRequisito(i.id)
            }}
          >
            {read(gravando) === `req:${i.id}` ? x.instalando : x.instalar}
          </Button>
        ) : null}
      </Stack>
    </Collapsible>
  )
}

function CorpoRequisitos({ r }: { r: Requisitos }) {
  return (
    <Stack gap="sm">
      {r.itens.map(i => (
        <ItemRequisito key={i.id} i={i} />
      ))}
      <Mensagem secao="requisitos" />
    </Stack>
  )
}

export function SecaoRequisitos({ r }: { r: Requisitos }) {
  return (
    <Secao titulo={t.requisitos.titulo} descricao={t.requisitos.explica}>
      <CorpoRequisitos r={r} />
    </Secao>
  )
}

/** Dois cliques: o primeiro só arma a confirmação. */
export function CorpoDesinstalar() {
  const x = t.desinstalar
  const ocupado = read(gravando) !== null
  return (
    <Stack gap="sm">
      <Text weight="medium">{x.titulo}</Text>
      <Text size="sm" muted>
        {x.explica}
      </Text>
      {read(confirmandoDesinstalar) ? (
        <Row gap="sm">
          <Button size="sm" tone="danger" disabled={ocupado} onPress={() => void desinstalar()}>
            {read(gravando) === 'desinstalar' ? x.removendo : x.confirmar}
          </Button>
          <Button size="sm" disabled={ocupado} onPress={() => set(confirmandoDesinstalar, false)}>
            {x.cancelar}
          </Button>
        </Row>
      ) : (
        <Button size="sm" tone="danger" icon="delete" disabled={ocupado} onPress={() => set(confirmandoDesinstalar, true)}>
          {x.botao}
        </Button>
      )}
      <Mensagem secao="desinstalar" />
    </Stack>
  )
}

export function ConfigInstalacao() {
  const r = read(requisitos)
  return (
    <Stack gap="md">
      <Stack gap="sm">
        <Text muted size="xs">
          {t.requisitos.explica}
        </Text>
        {r ? (
          <CorpoRequisitos r={r} />
        ) : (
          <>
            <Text muted>{t.requisitos.naoVerificados}</Text>
            <Mensagem secao="requisitos" />
          </>
        )}
        <Button size="sm" icon="refresh" disabled={read(gravando) !== null} onPress={() => void verificarAgora()}>
          {read(gravando) === 'req:verificar' ? t.requisitos.verificando : t.requisitos.verificar}
        </Button>
      </Stack>
      <CorpoDesinstalar />
    </Stack>
  )
}
