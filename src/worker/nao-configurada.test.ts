import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paths } from '../core/paths.ts'
import type { Medida } from '../core/tipos.ts'
import { cfg, conta } from '../../test/helpers/pool.ts'
import { AMBIENTE_VAZIO, montarEstado } from './estado.ts'

const AGORA = 1_800_000_000_000
const medida = (c: string, extra: Partial<Medida>): Medida => ({ conta: c, curta: null, longa: null, resetLongaTs: null, estado: 'sem_medida', medidaTs: AGORA, ...extra })
const estado = (medidas: Medida[]) =>
  montarEstado(paths('/nao-existe'), cfg([conta('team'), conta('work')]), null, { ...AMBIENTE_VAZIO, medidas, orca: { rodando: true, versao: null } }, AGORA, '/h')

test('nao_configurada não gera alerta e expõe o motivo; sem_login de conta configurada continua alertando', () => {
  const e = estado([medida('team', { estado: 'nao_configurada', erro: 'pasta_ausente:/h/.claude-team' }), medida('work', { estado: 'sem_login', acao: 'claude auth login' })])
  assert.deepEqual(e.alertas.map((a) => [a.codigo, a.params?.conta]), [['sem_login', 'work']])
  const cota = e.pool.contas[0].cota!
  assert.deepEqual([cota.estado, cota.curta, cota.longa, cota.erro], ['nao_configurada', null, null, 'pasta_ausente:/h/.claude-team'])
})
