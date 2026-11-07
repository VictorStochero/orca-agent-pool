// Configurações > Imposição: hooks de cada agente.
import { Button, plugin, Row, read, Stack, set, Text } from 'orca'
import { Arquivos, Mensagem } from './comum'
import { textoErro } from './erros'
import { atualizar, avisar, erroHooks, gravando, hooks } from './estado'
import { t } from './textos'

async function alterarHook(agente: string, acao: 'remover' | 'reinstalar'): Promise<void> {
  set(gravando, `hook:${agente}`)
  try {
    set(hooks, await plugin.request(`hooks.${acao}`, { agente }))
    set(erroHooks, false)
    avisar('hooks', { tom: 'success', texto: t.salvo })
    await atualizar(true)
  } catch (e) {
    avisar('hooks', { tom: 'danger', texto: textoErro(e) })
  } finally {
    set(gravando, null)
  }
}

function CorpoImposicao() {
  return (
    <Stack gap="sm">
      {read(erroHooks) ? <Text tone="danger">{t.imposicao.indisponivel}</Text> : null}
      {read(hooks).map(h => (
        <Stack key={h.agente} gap="xs">
          <Text weight="medium">{h.agente}</Text>
          <Text tone={h.estado === 'erro' ? 'danger' : undefined}>{t.imposicao.estados[h.estado]}</Text>
          {h.detalhe ? <Text size="xs">{h.detalhe}</Text> : null}
          {h.estado !== 'instalado' && h.arquivos?.length ? <Arquivos titulo={t.imposicao.grava} lista={h.arquivos} /> : null}
          <Row gap="sm">
            {h.estado === 'instalado' || h.estado === 'desatualizado' ? (
              <Button size="sm" tone="danger" disabled={read(gravando) !== null} onPress={() => void alterarHook(h.agente, 'remover')}>
                {t.imposicao.remover}
              </Button>
            ) : null}
            <Button size="sm" disabled={read(gravando) !== null} onPress={() => void alterarHook(h.agente, 'reinstalar')}>
              {h.estado === 'instalado' ? t.imposicao.reinstalar : t.imposicao.instalar}
            </Button>
          </Row>
        </Stack>
      ))}
      <Mensagem secao="hooks" />
    </Stack>
  )
}

export function ConfigImposicao() {
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        {t.imposicao.descricao}
      </Text>
      <CorpoImposicao />
    </Stack>
  )
}
