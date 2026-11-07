// Callout "Atenção" no topo do painel.
import { Callout, Code, Stack, Text } from 'orca'
import type { Alerta } from '../protocol'
import { codigosConfig } from './erros'
import { t } from './textos'

function textoAlerta(a: Alerta): string {
  const p = a.params ?? {}
  switch (a.codigo) {
    case 'config_ilegivel':
      return t.alertas.config_ilegivel(codigosConfig(p.detalhe ?? ''))
    case 'orca_indisponivel':
      return t.alertas.orca_indisponivel
    case 'sem_login':
      return t.alertas.sem_login(p.conta ?? '')
    case 'erro_medida':
      return t.alertas.erro_medida(p.conta ?? '', p.detalhe)
    case 'teste_parado':
      return t.alertas.teste_parado(p.pid ?? null, p.onde ?? '–')
  }
}

export function Atencao({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) return null
  return (
    <Callout tone={alertas.some(a => a.nivel === 'erro') ? 'danger' : 'warning'} title={t.atencao}>
      <Stack gap="xs">
        {alertas.map((a, i) => (
          <Stack key={`${i}-${a.codigo}`} gap="xs">
            <Text>{textoAlerta(a)}</Text>
            {a.acao ? <Code block>{a.acao}</Code> : null}
          </Stack>
        ))}
      </Stack>
    </Callout>
  )
}
