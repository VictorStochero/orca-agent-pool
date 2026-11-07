// Configurações > Contas: editar, ordenar, remover e cadastrar contas do pool.
import { atom, Button, Checkbox, IconButton, Input, Row, read, Select, Stack, set, Tab, Tabs, Text, update } from 'orca'
import type { Conta, Estado } from '../protocol'
import { ComDica, Dica, Mensagem, Salvar } from './comum'
import { avisar, edicoes, gravando, mudar, salvar } from './estado'
import { t } from './textos'

/** Conta escolhida em Configurações > Contas (null = a primeira). */
const contaEscolhida = atom<string | null>(null)
/** Formato aceito pelo núcleo (src/core/config.ts) para o nome da conta. */
const NOME_VALIDO = /^[a-z0-9_-]{1,32}$/
/** Conta com o pedido de remoção aguardando confirmação. */
const removendo = atom<string | null>(null)

function posicaoPapel(p: string): number {
  const i = t.pool.ordemPapeis.indexOf(p)
  return i < 0 ? t.pool.ordemPapeis.length : i
}

/** Sobe ou desce uma conta: grava a lista completa das contas na ordem nova. */
function mover(contas: Conta[], nome: string, delta: -1 | 1): Promise<boolean> {
  const nomes = contas.map(c => c.nome)
  const i = nomes.indexOf(nome)
  const j = i + delta
  if (i < 0 || j < 0 || j >= nomes.length) return Promise.resolve(false)
  ;[nomes[i], nomes[j]] = [nomes[j], nomes[i]]
  return salvar(`conta.${nome}`, [], { 'pool.ordem': nomes.join(',') })
}

/** Edição da conta escolhida: vagas, peso, config, papéis, ordem, "Não utilizar" e remover. */
function EdicaoConta({ c, e }: { c: Conta; e: Estado }) {
  const secao = `conta.${c.nome}`
  const chaveAtivo = `conta.${c.nome}.ativo`
  const chaveVagas = `conta.${c.nome}.vagas`
  const chavePeso = `conta.${c.nome}.peso`
  const chavePapeis = `conta.${c.nome}.papeis`
  const chaveConfig = `conta.${c.nome}.config`
  const chaveComando = `conta.${c.nome}.comando`
  const chaveModelo = `conta.${c.nome}.modelo`
  const ed = read(edicoes)
  const papeis = (ed[chavePapeis] ?? c.papeis.join(',')).split(',').filter(Boolean)
  const alterna = (p: string, marcado: boolean) =>
    mudar(chavePapeis, e.pool.papeis_validos.filter(x => (x === p ? marcado : papeis.includes(x))).join(','))
  const noPool = e.pool.contas.map(x => x.nome)
  const naoUtilizar = (ed[chaveAtivo] ?? (c.ativo ? 'sim' : 'nao')) === 'nao'
  const ocupado = read(gravando) !== null
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center">
        <Text size="sm">{t.pool.ordemNaTabela}</Text>
        <IconButton
          icon="collapse"
          label={t.pool.subir}
          size="xs"
          variant="ghost"
          disabled={ocupado || noPool[0] === c.nome}
          onPress={() => void mover(e.pool.contas, c.nome, -1)}
        />
        <IconButton
          icon="expand"
          label={t.pool.descer}
          size="xs"
          variant="ghost"
          disabled={ocupado || noPool[noPool.length - 1] === c.nome}
          onPress={() => void mover(e.pool.contas, c.nome, 1)}
        />
      </Row>
      <ComDica texto={t.pool.dicas.vagas}>
        <Input label={t.pool.vagas} value={ed[chaveVagas] ?? String(c.vagas)} onChange={x => mudar(chaveVagas, x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.peso}>
        <Input label={t.pool.pesoDaConta} value={ed[chavePeso] ?? String(c.peso)} onChange={x => mudar(chavePeso, x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.config}>
        <Input label={t.pool.config} value={ed[chaveConfig] ?? c.config ?? ''} onChange={x => mudar(chaveConfig, x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.novoComando}>
        <Input label={t.pool.comandoDaConta} value={ed[chaveComando] ?? c.comando ?? ''} onChange={x => mudar(chaveComando, x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.modelo}>
        <Input label={t.pool.modelo} value={ed[chaveModelo] ?? c.modelo ?? ''} onChange={x => mudar(chaveModelo, x)} />
      </ComDica>
      <Row gap="xs" align="center">
        <Checkbox label={t.pool.naoUtilizar} checked={naoUtilizar} onChange={m => mudar(chaveAtivo, m ? 'nao' : 'sim')} />
        <Dica texto={t.pool.dicas.naoUtilizar} />
      </Row>
      <Stack gap="xs">
        <Text weight="medium" size="sm">
          {t.pool.papeis}
        </Text>
        {[...e.pool.papeis_validos]
          .sort((a, b) => posicaoPapel(a) - posicaoPapel(b))
          .map(p => (
            <Row key={p} gap="xs" align="center">
              <Checkbox label={t.pool.nomesPapel[p] ?? p} checked={papeis.includes(p)} onChange={m => alterna(p, m)} />
              <Dica texto={t.pool.dicasPapel[p] ?? p} />
            </Row>
          ))}
      </Stack>
      <Mensagem secao={secao} />
      <Salvar secao={secao} chaves={[chaveVagas, chavePeso, chavePapeis, chaveConfig, chaveComando, chaveModelo, chaveAtivo]} />
      {read(removendo) === c.nome ? (
        <Stack gap="xs">
          <Text tone="warning">{t.pool.confirmarRemocao(c.nome)}</Text>
          <Row gap="sm">
            <Button
              size="sm"
              tone="danger"
              icon="delete"
              onPress={() => {
                set(removendo, null)
                void salvar(secao, [], { [`conta.${c.nome}.remover`]: '1' }).then(ok => {
                  if (ok) set(contaEscolhida, null)
                })
              }}
            >
              {t.pool.confirmar}
            </Button>
            <Button size="sm" variant="ghost" onPress={() => set(removendo, null)}>
              {t.pool.cancelar}
            </Button>
          </Row>
        </Stack>
      ) : c.origem === 'manual' ? (
        <Button size="sm" variant="outline" tone="danger" icon="delete" onPress={() => set(removendo, c.nome)}>
          {t.pool.remover}
        </Button>
      ) : null}
    </Stack>
  )
}

function NovaConta() {
  const ed = read(edicoes)
  const nome = (ed['nova.nome'] ?? '').trim()
  const comando = (ed['nova.comando'] ?? '').trim()
  const config = (ed['nova.config'] ?? '').trim()
  const criar = async () => {
    if (!NOME_VALIDO.test(nome)) return avisar('nova', { tom: 'danger', texto: t.pool.nomeInvalido })
    const extras: Record<string, string> = { [`conta.${nome}.adicionar`]: 'auto' }
    if (config) extras[`conta.${nome}.config`] = config
    if (comando) extras[`conta.${nome}.comando`] = comando
    if (await salvar('nova', [], extras))
      update(edicoes, p => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('nova.'))))
  }
  return (
    <Stack gap="sm">
      <Text weight="medium">{t.pool.nova}</Text>
      <Input label={t.pool.novaNome} value={ed['nova.nome'] ?? ''} onChange={x => mudar('nova.nome', x)} />
      <ComDica texto={t.pool.dicas.novoComando}>
        <Input label={t.pool.comandoCli} value={ed['nova.comando'] ?? ''} onChange={x => mudar('nova.comando', x)} />
      </ComDica>
      <ComDica texto={t.pool.dicas.novoConfig}>
        <Input label={t.pool.novaConfig} value={ed['nova.config'] ?? ''} onChange={x => mudar('nova.config', x)} />
      </ComDica>
      <Mensagem secao="nova" />
      <Button size="sm" icon="add" disabled={read(gravando) !== null || !nome || (!comando && !config)} onPress={() => void criar()}>
        {t.pool.novaCriar}
      </Button>
    </Stack>
  )
}

export function ConfigContas({ e }: { e: Estado }) {
  const { pool } = e
  const escolhida = read(contaEscolhida)
  const conta = pool.contas.find(c => c.nome === escolhida) ?? pool.contas[0]
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        {t.configuracoes.linhas.contas}
      </Text>
      <Tabs label={t.configuracoes.contasAbas.assuntos} defaultValue="configurar">
        <Tab value="configurar" label={t.configuracoes.contasAbas.configurar}>
          {conta ? (
            <Stack gap="sm">
              <Select
                label={t.pool.escolherConta}
                value={conta.nome}
                options={pool.contas.map(c => ({ value: c.nome, label: c.ativo ? c.nome : `${c.nome} (${t.pool.naoUtilizada})` }))}
                onChange={x => {
                  set(removendo, null)
                  set(contaEscolhida, x)
                }}
              />
              <EdicaoConta key={conta.nome} c={conta} e={e} />
            </Stack>
          ) : (
            <Text muted>{t.pool.semContas}</Text>
          )}
        </Tab>
        <Tab value="cadastrar" label={t.configuracoes.contasAbas.cadastrar}>
          <NovaConta />
        </Tab>
      </Tabs>
    </Stack>
  )
}
