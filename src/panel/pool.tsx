// Seção Pool (só leitura) e os campos de configuração do pool.
import { atom, Button, Input, read, Select, Spinner, Stack, set, Text } from 'orca'
import type { Conta, Estado } from '../protocol'
import { type Campo, ComDica, type Detalhe, type Linha, Mensagem, Salvar, Secao, se, TabelaExpansivel } from './comum'
import { edicoes, medindo, medirCotas, mudar } from './estado'
import { t } from './textos'

/** Linhas abertas da tabela (várias ao mesmo tempo; clicar de novo recolhe). */
const abertasConta = atom<string[]>([])

/** Conta ativa que precisa de ação: o valor da cota (se houver) é velho e não aparece. */
const comProblema = (c: Conta) => c.ativo && (c.cota?.estado === 'sem_login' || c.cota?.estado === 'erro')

const naoConfigurada = (c: Conta) => c.cota?.estado === 'nao_configurada'
const situacaoNaoConfigurada = (m: NonNullable<Conta['cota']>['motivo']) =>
  `${t.pool.naoConfigurada}: ${m ? t.pool.motivosNaoConfigurada[m.tipo](m.valor) : '–'}`

/** Célula de cota da tabela: aviso sem leitura, traço se a conta não está configurada, senão o percentual. */
const celulaCota = (c: Conta, valor: number | null | undefined, alerta: boolean | undefined) =>
  comProblema(c) ? `⚠ ${t.pool.semLeitura}` : naoConfigurada(c) ? '–' : t.pool.percentual(valor ?? null, alerta ?? false)

export function SecaoPool({ e }: { e: Estado }) {
  const { pool } = e
  const linhas: Linha[] = pool.contas.map(c => {
    const medida = c.cota && (c.cota.estado === 'ok' || c.cota.estado === 'antiga') ? c.cota : null
    return {
      key: c.nome,
      cells: {
        conta: c.ativo ? c.nome : `${c.nome} (${t.pool.naoUtilizada})`,
        vagas: t.pool.vagasDaConta(c.usadas, c.vagas),
        sessoes: c.sessoes === null ? '–' : c.sessoes.length,
        h5: celulaCota(c, c.cota?.curta, c.cota?.alerta_curta),
        semanal: celulaCota(c, c.cota?.longa, c.cota?.alerta_longa),
      },
      detalhes: [
        ...se(t.pool.situacao, naoConfigurada(c) && situacaoNaoConfigurada(c.cota?.motivo)),
        ...se(
          t.pool.problema,
          comProblema(c) && c.cota && (c.cota.estado === 'sem_login' ? t.pool.semLogin : t.pool.erroMedida(c.cota.erro)),
        ),
        ...se(t.pool.acao, comProblema(c) && c.cota?.acao),
        ...se(t.pool.situacao, !c.ativo && t.pool.naoUtilizadaDetalhe),
        ...se(t.pool.rotulo, c.rotulo),
        [t.pool.agente, c.agente ?? '-'],
        ...se(t.pool.modelo, c.modelo_efetivo && t.pool.modeloValor(c.modelo_efetivo, c.limite_seguido)),
        [t.pool.peso, c.peso],
        [t.pool.papeis, c.papeis.map(p => t.pool.nomesPapel[p] ?? p).join(', ') || '-'],
        [t.pool.janelas, medida ? t.pool.janelasValor(medida.curta, medida.longa) : t.pool.semMedida],
        ...(medida?.limites.map(
          (l): Detalhe => [
            l.nome,
            t.pool.limiteValor(
              l.curta === null ? '–' : t.pool.percentual(l.curta, false),
              l.longa === null ? '–' : t.pool.percentual(l.longa, false),
            ),
          ],
        ) ?? []),
        [t.pool.medidaHa, c.cota?.medida_ha_min != null ? t.pool.minutos(c.cota.medida_ha_min) : '-'],
        ...se(t.pool.aviso, c.cota?.estado === 'antiga' && c.cota.medida_ha_min != null && t.pool.medidaAntiga(c.cota.medida_ha_min)),
        [t.pool.vagasEmUso, [...c.ocupantes.map(o => o.dispatch ?? '?'), ...(c.agentes ?? [])].join(', ') || t.pool.nenhuma],
        ...se(t.pool.colSessoes, c.sessoes && (c.sessoes.join(', ') || t.pool.nenhuma)),
      ],
    }
  })
  return (
    <Secao
      titulo={t.pool.titulo}
      descricao={t.pool.resumo(pool.maquina.usadas, pool.maquina.teto, pool.sessoes, pool.escolha)}
      acao={
        pool.contas.length === 0 ? null : read(medindo) ? (
          <Spinner label={t.pool.medindo} />
        ) : (
          <Button icon="refresh" size="sm" variant="outline" onPress={() => void medirCotas()}>
            {t.pool.medirCotas}
          </Button>
        )
      }
    >
      {pool.contas.length === 0 ? (
        <Text muted>{t.pool.semContas}</Text>
      ) : (
        <TabelaExpansivel
          label={t.pool.tabela}
          colunas={[
            { key: 'conta', label: t.pool.colConta, largura: 80 },
            { key: 'vagas', label: t.pool.colVagas, largura: 46 },
            { key: 'sessoes', label: t.pool.colSessoes, align: 'end', largura: 62 },
            { key: 'h5', label: t.pool.col5h, align: 'end', largura: 48 },
            { key: 'semanal', label: t.pool.colSemanal, align: 'end', largura: 64 },
          ]}
          linhas={linhas}
          abertas={read(abertasConta)}
          onAbrir={k => set(abertasConta, k)}
        />
      )}
    </Secao>
  )
}

export const camposPool = ({ pool }: Estado): Campo[] => [
  { chave: 'pool.teto', rotulo: t.pool.teto, salvo: String(pool.teto) },
  { chave: 'pool.ram_min', rotulo: t.pool.ramMin, salvo: String(pool.ram_min) },
  { chave: 'pool.escolha', rotulo: t.pool.escolha, salvo: pool.escolha, mostrar: v => t.pool.escolhaOpcoes[v] ?? v },
]

export function ConfigPool({ e }: { e: Estado }) {
  const { pool } = e
  const ed = read(edicoes)
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        {t.configuracoes.linhas.pool}
      </Text>
      <ComDica texto={t.pool.dicas.teto}>
        <Input label={t.pool.teto} value={ed['pool.teto'] ?? String(pool.teto)} onChange={x => mudar('pool.teto', x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.ramMin}>
        <Input label={t.pool.ramMin} value={ed['pool.ram_min'] ?? String(pool.ram_min)} onChange={x => mudar('pool.ram_min', x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.escolha}>
        <Select
          label={t.pool.escolha}
          value={ed['pool.escolha'] ?? pool.escolha}
          options={[
            { value: 'ritmo', label: t.pool.escolhaOpcoes.ritmo },
            { value: 'ordem', label: t.pool.escolhaOpcoes.ordem },
          ]}
          onChange={x => mudar('pool.escolha', x)}
        />
      </ComDica>
      <Mensagem secao="pool" />
      <Salvar secao="pool" campos={camposPool(e)} />
    </Stack>
  )
}
