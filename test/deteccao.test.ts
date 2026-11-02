import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectar, sincronizarDetectadas } from '../src/core/deteccao.ts'
import type { Config } from '../src/core/tipos.ts'

test('opencode2 exige conta Orca mesmo com executável instalado', async () => {
  const home = mkdtempSync(join(tmpdir(), 'detecta-'))
  try {
    const exe = join(home, process.platform === 'win32' ? 'opencode.cmd' : 'opencode')
    writeFileSync(exe, '')
    chmodSync(exe, 0o755)
    const orca = (accounts: object[]) => ({ run: async () => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result: { opencode: { accounts, activeAccountId: null }, codex: { accounts: [], activeAccountId: null, systemDefault: { hasAuth: true, workspaceLabel: 'Personal (Plus)' } } } }) }) })
    const sem = await detectar(orca([]), home)
    assert.equal(sem.some(d => d.agente === 'opencode2'), false)
    assert.equal(sem.some(d => d.nome === 'codex-padrao'), true)
    const com = await detectar(orca([{ id: '12345678-0000', label: 'Equipe' }]), home)
    assert.equal(com.some(d => d.agente === 'opencode2'), true)
    assert.equal(com.some(d => d.nome === 'opencode-12345678'), true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('sincronizar preserva conta inativa, aplica padrões e é idempotente', () => {
  const c: Config = { versao: 1, pool: { teto: 0, ramMinGb: 0, escolha: 'ritmo', contas: [{ nome: 'codex', agente: 'codex', config: null, comando: null, vagas: 3, peso: 5, papeis: [], ativo: false, origem: 'manual' }] }, fila: { modo: 'banco', vagas: 2, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 300 } }
  const detectadas = [{ nome: 'codex', agente: 'codex', rotulo: 'instalado' }, { nome: 'claude', agente: 'claude', rotulo: 'instalado' }]
  const nova = sincronizarDetectadas(c, detectadas)
  assert.equal(nova.pool.contas[0].ativo, false)
  assert.equal(nova.pool.contas[0].vagas, 3)
  assert.equal(nova.pool.contas[1].vagas, 1)
  assert.equal(nova.pool.contas[1].ativo, true)
  assert.ok(nova.pool.contas[1].papeis.includes('escritor'))
  assert.deepEqual(sincronizarDetectadas(nova, detectadas), nova)
  assert.equal(c.pool.contas.length, 1)
})

test('detecta Claude padrão por cota nativa e continua localmente com resposta nula', async () => {
  const home = mkdtempSync(join(tmpdir(), 'detecta-'))
  try {
    const exe = join(home, process.platform === 'win32' ? 'codex.cmd' : 'codex')
    writeFileSync(exe, '')
    chmodSync(exe, 0o755)
    const claude = await detectar({ run: async () => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result: { claude: { accounts: [], activeAccountId: null }, rateLimits: { claude: { provider: 'claude', status: 'ok', weekly: { usedPercent: 31 } } } } }) }) }, '')
    assert.ok(claude.some(c => c.nome === 'claude-padrao'))
    const local = await detectar({ run: async () => ({ code: 0, stderr: '', stdout: 'null' }) }, home)
    assert.ok(local.some(c => c.nome === 'codex'))
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('detectada no perfil padrão não duplica a conta manual do mesmo agente; conta gerenciada entra', () => {
  const manual = (nome: string, agente: string, config: string | null = null) => ({ nome, agente, config, comando: null, vagas: 1, peso: 1, papeis: ['escritor' as const], ativo: true, origem: 'manual' as const })
  const c: Config = { versao: 1, pool: { teto: 0, ramMinGb: 0, escolha: 'ritmo', contas: [manual('main', 'claude'), manual('work', 'claude', '~/.claude-work'), manual('cx', 'codex'), manual('ag', 'antigravity')] }, fila: { modo: 'banco', vagas: 2, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 300 } }
  const detectadas = [{ nome: 'claude-padrao', agente: 'claude', rotulo: 'x' }, { nome: 'codex-padrao', agente: 'codex', rotulo: 'y' }, { nome: 'antigravity', agente: 'antigravity', rotulo: 'z' }, { nome: 'claude-abcd1234', agente: 'claude', rotulo: 'w', gerenciada: true }]
  const nova = sincronizarDetectadas(c, detectadas)
  assert.deepEqual(nova.pool.contas.map(x => x.nome), ['main', 'work', 'cx', 'ag', 'claude-abcd1234'])
  const soComPasta = sincronizarDetectadas({ ...c, pool: { ...c.pool, contas: [manual('work', 'claude', '~/.claude-work'), { ...manual('orca-cx', 'codex'), origem: 'orca' }] } }, detectadas)
  assert.deepEqual(soComPasta.pool.contas.map(x => x.nome), ['work', 'orca-cx', 'claude-padrao', 'codex-padrao', 'antigravity', 'claude-abcd1234'])
})

test('conta detectada removida não volta no ciclo seguinte; desativada continua como está', async () => {
  const { aplicar } = await import('../src/core/config.ts')
  const detectadas = [{ nome: 'codex-padrao', agente: 'codex', rotulo: 'x' }, { nome: 'claude-padrao', agente: 'claude', rotulo: 'y' }]
  const base: Config = { versao: 1, pool: { teto: 0, ramMinGb: 0, escolha: 'ritmo', contas: [] }, fila: { modo: 'banco', vagas: 2, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 300 } }
  let c = sincronizarDetectadas(base, detectadas)
  assert.equal(c.pool.contas.length, 2)
  c = aplicar(c, { 'conta.codex-padrao.remover': '1', 'conta.claude-padrao.ativo': 'nao' })
  c = sincronizarDetectadas(c, detectadas)
  assert.deepEqual(c.pool.contas.map(x => [x.nome, x.ativo]), [['claude-padrao', false]])
})

test('conta gerenciada do Orca entra só como medida, sem papel de trabalho; a padrão mantém os papéis', async () => {
  const orca = { run: async () => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result: { claude: { accounts: [{ id: 'abcdef1234', label: 'Equipe' }], activeAccountId: null, systemDefault: { hasAuth: true } } } }) }) }
  const d = await detectar(orca, '')
  const c = sincronizarDetectadas({ versao: 1, pool: { teto: 0, ramMinGb: 0, escolha: 'ritmo', contas: [] }, fila: { modo: 'banco', vagas: 2, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 300 } }, d)
  assert.deepEqual(c.pool.contas.find(x => x.nome === 'claude-abcdef12')!.papeis, [])
  assert.ok(c.pool.contas.find(x => x.nome === 'claude-padrao')!.papeis.includes('escritor'))
})
