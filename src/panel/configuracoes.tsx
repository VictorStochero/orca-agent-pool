// Seção Configurações: abas por assunto; a edição das contas, da fila, do pool etc. fica no módulo de cada uma.
import { atom, Button, Card, Collapsible, Input, read, Stack, set, storage, Tab, Tabs, Text, update } from 'orca'
import { CHAVE_INTERVALO, type Estado, INTERVALO_S } from '../protocol'
import { ComDica, Mensagem } from './comum'
import { ConfigContas } from './contas'
import { avisar, edicoes, mudar } from './estado'
import { ConfigFila } from './fila'
import { ConfigImposicao } from './hooks'
import { ConfigPool } from './pool'
import { ConfigInstalacao } from './requisitos'
import { t } from './textos'

const intervalo = atom(INTERVALO_S.padrao)

/** Traz para o painel o intervalo já gravado. */
export function carregarIntervalo(): void {
  void storage.get(CHAVE_INTERVALO).then(v => typeof v === 'number' && set(intervalo, v))
}

async function salvarIntervalo(): Promise<void> {
  const bruto = (read(edicoes)['painel.intervalo'] ?? String(read(intervalo))).trim()
  const n = Number(bruto)
  if (!/^\d+$/.test(bruto) || n < INTERVALO_S.min || n > INTERVALO_S.max) {
    return avisar('painel', { tom: 'danger', texto: t.painel.invalido(INTERVALO_S.min, INTERVALO_S.max) })
  }
  try {
    await storage.set(CHAVE_INTERVALO, n)
    set(intervalo, n)
    update(edicoes, p => Object.fromEntries(Object.entries(p).filter(([c]) => c !== 'painel.intervalo')))
    avisar('painel', { tom: 'success', texto: t.salvo })
  } catch (e) {
    avisar('painel', { tom: 'danger', texto: (e as { message?: string }).message ?? String(e) })
  }
}

function ConfigPainel() {
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        {t.configuracoes.linhas.painel}
      </Text>
      <ComDica texto={t.painel.dica}>
        <Input
          label={t.painel.intervalo}
          value={read(edicoes)['painel.intervalo'] ?? String(read(intervalo))}
          onChange={x => mudar('painel.intervalo', x)}
        />
      </ComDica>
      <Mensagem secao="painel" />
      <Button size="sm" icon="check" onPress={() => void salvarIntervalo()}>
        {t.salvar}
      </Button>
    </Stack>
  )
}

export function SecaoConfiguracoes({ e }: { e: Estado }) {
  const abas = [
    { id: 'fila', corpo: <ConfigFila e={e} /> },
    { id: 'pool', corpo: <ConfigPool e={e} /> },
    { id: 'contas', corpo: <ConfigContas e={e} /> },
    { id: 'imposicao', corpo: <ConfigImposicao /> },
    { id: 'instalacao', corpo: <ConfigInstalacao /> },
    { id: 'painel', corpo: <ConfigPainel /> },
  ] as const
  return (
    <Card>
      <Collapsible title={t.configuracoes.titulo} description={t.configuracoes.descricao}>
        <Tabs label={t.configuracoes.assuntos} defaultValue="fila">
          {abas.map(a => (
            <Tab key={a.id} value={a.id} label={t.configuracoes.abas[a.id]}>
              {a.corpo}
            </Tab>
          ))}
        </Tabs>
      </Collapsible>
    </Card>
  )
}
