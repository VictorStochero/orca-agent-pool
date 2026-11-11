// Entry do painel. O painel só acessa a máquina pelo contrato do worker em src/protocol.ts.
// Só leitura nas tabelas (Fila e Pool, próprias: List + Box); toda a edição fica em Configurações, no fim.
import { Button, Card, EmptyState, Heading, type PanelContext, plugin, RelativeTime, Row, read, Spinner, Stack, Text } from 'orca'
import { Atencao } from './alertas'
import { manterAtualizando } from './atualizacao'
import { carregarIntervalo, SecaoConfiguracoes } from './configuracoes'
import { atualizar, carregando, concluido, erro, estado, requisitos } from './estado'
import { SecaoFila } from './fila'
import { SecaoPool } from './pool'
import { CorpoDesinstalar, SecaoRequisitos } from './requisitos'
import { t } from './textos'

export function setup(ctx: PanelContext): void {
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
        <Button icon="refresh" size="sm" disabled={read(carregando)} onPress={() => void atualizar()}>
          {t.atualizar}
        </Button>
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
          <Card>
            <CorpoDesinstalar />
          </Card>
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
    </Stack>
  )
}
