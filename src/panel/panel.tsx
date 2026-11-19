// Entry do painel. O painel só acessa a máquina pelo contrato do worker em src/protocol.ts.
// Só leitura nas tabelas (Fila e Pool, próprias: List + Box); toda a edição fica em Configurações, no fim.
import {
  atom,
  Box,
  Button,
  EmptyState,
  Heading,
  Link,
  type PanelContext,
  plugin,
  RelativeTime,
  Row,
  read,
  Spinner,
  Stack,
  set,
  Text,
} from 'orca'
import { Atencao } from './alertas'
import { manterAtualizando } from './atualizacao'
import { Secao } from './comum'
import { carregarIntervalo, SecaoConfiguracoes } from './configuracoes'
import { atualizar, concluido, erro, estado, requisitos } from './estado'
import { SecaoFila } from './fila'
import { SecaoPool } from './pool'
import { CorpoDesinstalar, SecaoRequisitos } from './requisitos'
import { t } from './textos'

const REPO = 'https://github.com/VictorStochero/orca-agent-pool'

/** Só o clique em Atualizar troca o botão pelo Spinner; a coleta automática não mexe nele. */
const clicado = atom(false)
/** Sinal da execução aberta do painel: o timer de um clique não mexe na execução seguinte. */
let aberto: AbortSignal | undefined

async function atualizarAgora(): Promise<void> {
  const sinal = aberto
  set(clicado, true)
  try {
    // Ao menos 1 s: uma coleta rápida faria o "Atualizando…" só piscar.
    await Promise.all([atualizar(), new Promise(r => setTimeout(r, 1000))])
  } finally {
    if (!sinal?.aborted) set(clicado, false)
  }
}

export function setup(ctx: PanelContext): void {
  aberto = ctx.signal
  ctx.subscriptions.push(plugin.on('estado.mudou', () => void atualizar()))
  carregarIntervalo()
  void manterAtualizando(ctx.signal)
  void atualizar()
}

function situacaoOrca(orca: { rodando: boolean | null; versao?: string | null }): string {
  if (orca.rodando === null) return t.orcaVerificando
  return orca.rodando ? (orca.versao ?? t.orcaRodando) : t.orcaForaDoAr
}

export default function Painel() {
  const e = read(estado)
  const x = read(erro)
  const r = read(requisitos)
  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Heading>{t.titulo}</Heading>
        {/* 32 px = altura do Button sm do Orca: o Spinner, mais baixo, encolhia a linha e o painel pulava na troca. */}
        <Box height={32} justify="center">
          {read(clicado) ? (
            <Spinner label={t.atualizando} />
          ) : (
            <Button icon="refresh" size="sm" onPress={() => void atualizarAgora()}>
              {t.atualizar}
            </Button>
          )}
        </Box>
      </Row>
      {x ? (
        <Stack gap="xs">
          <Text tone="danger" weight="medium">
            {t.coletorFalhou(x.code)}
          </Text>
          <Text tone="danger">{x.message}</Text>
        </Stack>
      ) : null}
      {r && !r.ok ? (
        <Stack gap="md">
          <SecaoRequisitos r={r} />
          <Secao>
            <CorpoDesinstalar />
          </Secao>
        </Stack>
      ) : e === null ? (
        x ? (
          <EmptyState title={t.semDados} description={t.coletorNaoRespondeu} icon="warning" />
        ) : (
          <Spinner label={t.carregando} />
        )
      ) : (
        <Stack gap="md">
          {read(concluido) ? <Text tone="success">{t.requisitos.instalados}</Text> : null}
          <Text muted size="xs">
            {t.atualizadoEm} <RelativeTime at={Date.parse(e.gerado_em)} />
            {` · ${t.dicaLinha}`}
          </Text>
          <Atencao alertas={e.alertas} />
          <Text size="xs" muted>
            {`${t.plugin} ${e.saude.plugin_versao ?? '?'} · ${t.orca} ${situacaoOrca(e.saude.orca)}`}
          </Text>
          <SecaoFila e={e} />
          <SecaoPool e={e} />
          <SecaoConfiguracoes e={e} />
        </Stack>
      )}
      <Stack gap="xs">
        <Text size="xs" muted>
          {t.rodape.estrela.antes}
          <Link href={REPO}>{t.rodape.estrela.link}</Link>
          {t.rodape.estrela.depois}
        </Text>
        <Text size="xs" muted>
          {t.rodape.issue.antes}
          <Link href={`${REPO}/issues/new`}>{t.rodape.issue.link}</Link>
          {t.rodape.issue.depois}
        </Text>
      </Stack>
    </Stack>
  )
}
