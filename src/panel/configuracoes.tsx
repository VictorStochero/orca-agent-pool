// Seção Configurações: um seletor de assunto (cabe em painel estreito); a edição das contas, da fila, do pool etc. fica no módulo de cada uma.
import { atom, Collapsible, Input, read, Select, Stack, set, storage, Text, update } from 'orca'
import { CHAVE_INTERVALO, type Estado, INTERVALO_S } from '../protocol'
import { type Campo, ComDica, Mensagem, pendentes, Salvar, Secao } from './comum'
import { ConfigContas, camposContas } from './contas'
import { avisar, edicoes, mudar } from './estado'
import { ConfigFila, camposFila } from './fila'
import { ConfigImposicao } from './hooks'
import { ConfigPool, camposPool } from './pool'
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

const camposPainel = (): Campo[] => [{ chave: 'painel.intervalo', rotulo: t.painel.intervalo, salvo: String(read(intervalo)) }]

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
      <Salvar secao="painel" campos={camposPainel()} acao={salvarIntervalo} />
    </Stack>
  )
}

const assuntoAtual = atom('fila')

export function SecaoConfiguracoes({ e }: { e: Estado }) {
  const assunto = read(assuntoAtual)
  const ed = read(edicoes)
  // Contagem de pendentes por assunto: o seletor e o título recolhido mostram o que ficou sem salvar fora da vista.
  const abas = [
    { id: 'fila', n: pendentes(camposFila(e), ed).length, corpo: <ConfigFila e={e} /> },
    { id: 'pool', n: pendentes(camposPool(e), ed).length, corpo: <ConfigPool e={e} /> },
    { id: 'contas', n: pendentes(camposContas(e), ed).length, corpo: <ConfigContas e={e} /> },
    { id: 'imposicao', n: 0, corpo: <ConfigImposicao /> },
    { id: 'instalacao', n: 0, corpo: <ConfigInstalacao /> },
    { id: 'painel', n: pendentes(camposPainel(), ed).length, corpo: <ConfigPainel /> },
  ] as const
  const total = abas.reduce((s, a) => s + a.n, 0)
  return (
    <Secao>
      <Collapsible title={t.configuracoes.titulo} description={total ? t.configuracoes.pendentes(total) : t.configuracoes.descricao}>
        <Stack gap="sm">
          <Select
            label={t.configuracoes.assuntos}
            value={assunto}
            options={abas.map(a => ({
              value: a.id,
              label: a.n ? `${t.configuracoes.abas[a.id]} · ${t.configuracoes.naoSalvas(a.n)}` : t.configuracoes.abas[a.id],
            }))}
            onChange={v => set(assuntoAtual, v)}
          />
          {abas.find(a => a.id === assunto)?.corpo}
        </Stack>
      </Collapsible>
    </Secao>
  )
}
