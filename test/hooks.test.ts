import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { estadoHooks, instalarHooks, pastasDasContas, removerHooks } from '../src/hooks/comum.ts'
import { guardarCasaReal } from './helpers/casa.ts'
import { cfg, conta } from './helpers/pool.ts'

guardarCasaReal()

const LAN = '/h/.agents/bin/agent-pool'
// No Windows o Codex roda o comando pelo PowerShell: o caminho entre aspas precisa do `&`.
const comando = (ag: string) => `${ag === 'codex' && process.platform === 'win32' ? '& ' : ''}"${LAN}" hook ${ag}`
const caminho = { claude: ['.claude', 'settings.json'], codex: ['.codex', 'hooks.json'] } as const

function setup(agente: 'claude' | 'codex', conteudo?: string) {
  const home = mkdtempSync(join(tmpdir(), 'hooks-'))
  const arq = join(home, ...caminho[agente])
  if (conteudo !== undefined) {
    mkdirSync(dirname(arq), { recursive: true })
    writeFileSync(arq, conteudo)
  }
  return { home, arq }
}
const terceiros = () =>
  `${JSON.stringify(
    {
      model: 'x',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash outro.sh' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'fim.sh' }] }],
      },
    },
    null,
    2,
  )}\n`

for (const ag of ['claude', 'codex'] as const) {
  test(`${ag}: primeira instalação registra a ausência original antes de criar hooks`, () => {
    const { home } = setup(ag)
    const [r] = instalarHooks(home, [ag], LAN)
    assert.equal(r.estado, 'instalado')
    assert.ok(r.backup)
    assert.equal(readFileSync(r.backup!, 'utf8'), '')
    assert.equal(existsSync(`${r.backup!}.ausente`), true)
  })

  test(`${ag}: falha ao criar backup impede a gravação dos hooks`, () => {
    const original = terceiros()
    const { home, arq } = setup(ag, original)
    const dir = join(home, '.agents', 'agent-pool', 'state')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'backup'), 'impede criar a pasta')
    assert.equal(instalarHooks(home, [ag], LAN)[0].estado, 'erro')
    assert.equal(readFileSync(arq, 'utf8'), original)
  })

  test(`${ag}: hook idêntico sem backup recupera a evidência antes de continuar`, () => {
    const { home, arq } = setup(ag, terceiros())
    const [primeiro] = instalarHooks(home, [ag], LAN)
    rmSync(primeiro.backup!)
    const atual = readFileSync(arq, 'utf8')
    const [r] = instalarHooks(home, [ag], LAN)
    assert.ok(r.backup)
    assert.equal(readFileSync(r.backup!, 'utf8'), atual)
    assert.equal(readFileSync(arq, 'utf8'), atual)
  })
  test(`${ag}: instala em arquivo ausente e em {} vazio`, () => {
    for (const ini of [undefined, '{}']) {
      const { home, arq } = setup(ag, ini)
      const [r] = instalarHooks(home, [ag], LAN)
      assert.equal(r.estado, 'instalado')
      const g = JSON.parse(readFileSync(arq, 'utf8')).hooks.PreToolUse
      assert.equal(g.length, 1)
      assert.equal(g[0].hooks[0].command, comando(ag))
      assert.equal(estadoHooks(home, LAN).find(e => e.agente === ag)?.estado, 'instalado')
    }
  })

  test(`${ag}: com hooks de terceiros, remover devolve o arquivo byte a byte`, () => {
    for (const orig of [terceiros(), terceiros().replace(/\n/g, '\r\n'), terceiros().slice(0, -1)]) {
      const { home, arq } = setup(ag, orig)
      instalarHooks(home, [ag], LAN)
      const meio = JSON.parse(readFileSync(arq, 'utf8')).hooks
      assert.equal(meio.PreToolUse.length, 2)
      assert.equal(meio.Stop.length, 1)
      assert.equal(removerHooks(home, [ag])[0].estado, 'removido')
      assert.equal(readFileSync(arq, 'utf8'), orig)
    }
  })

  test(`${ag}: idempotente, backup só na primeira escrita, lançador novo atualiza`, () => {
    const orig = terceiros()
    const { home, arq } = setup(ag, orig)
    const [a] = instalarHooks(home, [ag], LAN)
    assert.ok(a.backup && readFileSync(a.backup, 'utf8') === orig)
    const depois = readFileSync(arq, 'utf8')
    assert.equal(instalarHooks(home, [ag], LAN)[0].estado, 'ja')
    assert.equal(readFileSync(arq, 'utf8'), depois)
    const [c] = instalarHooks(home, [ag], '/outro/agent-pool')
    assert.equal(c.estado, 'instalado')
    assert.equal(c.backup, undefined)
    assert.equal(JSON.parse(readFileSync(arq, 'utf8')).hooks.PreToolUse.length, 2)
    assert.equal(removerHooks(home, [ag])[0].estado, 'removido')
    assert.equal(readFileSync(arq, 'utf8'), orig)
    assert.equal(removerHooks(home, [ag])[0].estado, 'ausente')
  })

  test(`${ag}: hook de terceiro dentro do nosso grupo sobrevive a reinstalar e a remover`, () => {
    const alheio = { type: 'command', command: 'meu-lint.sh' }
    const velho = { type: 'command', command: `"/velho/agent-pool" hook ${ag}` }
    const { home, arq } = setup(ag, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [velho, alheio] }] } }))
    assert.equal(instalarHooks(home, [ag], LAN)[0].estado, 'instalado')
    const [g] = JSON.parse(readFileSync(arq, 'utf8')).hooks.PreToolUse
    assert.deepEqual(g.hooks.map((h: { command: string }) => h.command).sort(), [comando(ag), 'meu-lint.sh'].sort())
    assert.equal(instalarHooks(home, [ag], LAN)[0].estado, 'ja')
    assert.equal(removerHooks(home, [ag])[0].estado, 'removido')
    assert.deepEqual(JSON.parse(readFileSync(arq, 'utf8')).hooks.PreToolUse, [{ matcher: 'Bash|PowerShell', hooks: [alheio] }])
  })

  test(`${ag}: arquivo ilegível vira estado erro, sem lançar`, () => {
    const { home, arq } = setup(ag, '{}')
    unlinkSync(arq)
    mkdirSync(arq) // ler um diretório dá EISDIR, como o EACCES de um arquivo de outro usuário
    assert.equal(estadoHooks(home, LAN).find(e => e.agente === ag)?.estado, 'erro')
  })

  test(`${ag}: JSON inválido não é tocado e reporta erro`, () => {
    const lixo = '{ "hooks": [oops'
    const { home, arq } = setup(ag, lixo)
    assert.equal(instalarHooks(home, [ag], LAN)[0].estado, 'erro')
    assert.equal(removerHooks(home, [ag])[0].estado, 'erro')
    assert.equal(estadoHooks(home, LAN).find(e => e.agente === ag)?.estado, 'erro')
    assert.equal(readFileSync(arq, 'utf8'), lixo)
    assert.equal(existsSync(join(home, '.agents')), false)
  })

  test(`${ag}: lançador com aspas, $, crase, % ou quebra de linha no caminho não vira hook`, () => {
    for (const lan of ['/h/a$b/agent-pool', '/h/a`b/agent-pool', '/h/a"b/agent-pool', '/h/a%OS%b/agent-pool', '/h/a\nb/agent-pool']) {
      const { home, arq } = setup(ag, '{}')
      const [r] = instalarHooks(home, [ag], lan)
      assert.equal(r.estado, 'erro', lan)
      assert.equal(r.erro, 'caminho_invalido')
      assert.equal(readFileSync(arq, 'utf8'), '{}')
      assert.equal(existsSync(join(home, '.agents')), false)
    }
  })
}

test('o modo do arquivo do agente é preservado ao instalar e remover', t => {
  if (process.platform === 'win32') return t.skip('sem modo POSIX')
  const { home, arq } = setup('claude', terceiros())
  chmodSync(arq, 0o600)
  instalarHooks(home, ['claude'], LAN)
  assert.equal(statSync(arq).mode & 0o777, 0o600)
  removerHooks(home, ['claude'])
  assert.equal(statSync(arq).mode & 0o777, 0o600)
})

test('codex: grupo sem matcher e timeout 15; claude: matcher Bash|PowerShell', () => {
  const { home } = setup('claude')
  instalarHooks(home, ['claude', 'codex'], LAN)
  const c = JSON.parse(readFileSync(join(home, ...caminho.claude), 'utf8')).hooks.PreToolUse[0]
  const x = JSON.parse(readFileSync(join(home, ...caminho.codex), 'utf8')).hooks.PreToolUse[0]
  assert.equal(c.matcher, 'Bash|PowerShell')
  assert.equal(x.matcher, undefined)
  assert.equal(x.hooks[0].timeout, 15)
})

test('codex: instalar, trocar o lançador e remover nunca tocam no config.toml (o próprio Codex pede a confiança)', () => {
  const orig = 'model = "x"\n\n[hooks.state.\'outro:pre_tool_use:0:0\']\nenabled = true\ntrusted_hash = "sha256:terceiro"\n'
  const { home, arq } = setup('codex', terceiros())
  const toml = join(home, '.codex', 'config.toml')
  writeFileSync(toml, orig)
  assert.equal(instalarHooks(home, ['codex'], LAN)[0].estado, 'instalado')
  assert.equal(instalarHooks(home, ['codex'], LAN)[0].estado, 'ja')
  instalarHooks(home, ['codex'], '/outro/agent-pool')
  removerHooks(home, ['codex'])
  assert.equal(readFileSync(toml, 'utf8'), orig)
  assert.equal(readFileSync(arq, 'utf8'), terceiros())
  const semToml = setup('codex')
  instalarHooks(semToml.home, ['codex'], LAN)
  removerHooks(semToml.home, ['codex'])
  assert.equal(existsSync(join(semToml.home, '.codex', 'config.toml')), false)
})

test('conta inativa: remover alcança a pasta de config dela', () => {
  const { home } = setup('claude')
  const c = cfg([conta('a', { config: '~/.claude-2', ativo: false })])
  mkdirSync(join(home, '.claude-2'))
  const pastas = pastasDasContas(c, home)
  assert.deepEqual(pastasDasContas(cfg([conta('a', { config: '~/.claude-typo' })]), home), {})
  instalarHooks(home, ['claude'], LAN, pastas)
  const dois = join(home, '.claude-2', 'settings.json')
  assert.ok(readFileSync(dois, 'utf8').includes('hook claude'))
  removerHooks(home, ['claude'], pastas)
  assert.equal(existsSync(dois), false) // o arquivo não existia antes do Instalar: sai inteiro
})

test('codex: reinstalar com lançador novo entra no lugar do nosso grupo; o de terceiro depois dele não muda de índice', () => {
  const nossoVelho = { hooks: [{ type: 'command', command: '"/velho/agent-pool" hook codex', timeout: 15 }] }
  const terceiro = { hooks: [{ type: 'command', command: 'guarda.sh' }] }
  const { home, arq } = setup('codex', JSON.stringify({ hooks: { PreToolUse: [nossoVelho, terceiro] } }))
  instalarHooks(home, ['codex'], LAN)
  const grupos = JSON.parse(readFileSync(arq, 'utf8')).hooks.PreToolUse
  assert.equal(grupos[1].hooks[0].command, 'guarda.sh')
  assert.ok(grupos[0].hooks[0].command.includes(LAN))
  assert.equal(estadoHooks(home, LAN).find(e => e.agente === 'codex')?.estado, 'instalado')
})

// --- links e pastas de contas ---
const comLink = (alvo: string, link: string): boolean => {
  try {
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(alvo, link)
    return true
  } catch {
    return false // sem permissão de link (Windows comum)
  }
}

for (const ag of ['claude', 'codex'] as const) {
  test(`${ag}: arquivo que é link continua link e o alvo recebe o hook`, t => {
    const { home, arq } = setup(ag)
    const alvo = join(home, 'dotfiles', 'alvo.json')
    mkdirSync(dirname(alvo), { recursive: true })
    writeFileSync(alvo, terceiros())
    if (!comLink(alvo, arq)) return t.skip('sem permissão de link')
    assert.equal(instalarHooks(home, [ag], LAN)[0].estado, 'instalado')
    assert.ok(lstatSync(arq).isSymbolicLink())
    assert.equal(JSON.parse(readFileSync(alvo, 'utf8')).hooks.PreToolUse.length, 2)
    removerHooks(home, [ag])
    assert.ok(lstatSync(arq).isSymbolicLink())
    assert.equal(readFileSync(alvo, 'utf8'), terceiros())
  })
}

test('claude: pasta de config de conta ganha o hook; remover limpa as duas; backup por pasta', () => {
  const { home } = setup('claude', terceiros())
  const conta = join(home, '.claude-2')
  mkdirSync(conta)
  writeFileSync(join(conta, 'settings.json'), '{\n  "model": "y"\n}\n')
  const pastas = { claude: ['~/.claude-2'] }
  const r = instalarHooks(home, ['claude'], LAN, pastas)
  assert.deepEqual(
    r.map(x => x.estado),
    ['instalado', 'instalado'],
  )
  assert.notEqual(r[0].backup, r[1].backup)
  assert.equal(readFileSync(r[1].backup!, 'utf8'), '{\n  "model": "y"\n}\n')
  for (const f of [join(home, '.claude', 'settings.json'), join(conta, 'settings.json')]) {
    assert.ok(JSON.stringify(JSON.parse(readFileSync(f, 'utf8')).hooks.PreToolUse).includes('hook claude'), f)
  }
  assert.deepEqual(
    estadoHooks(home, LAN, pastas)
      .filter(e => e.agente === 'claude')
      .map(e => e.estado),
    ['instalado', 'instalado'],
  )
  assert.deepEqual(
    removerHooks(home, ['claude'], pastas).map(x => x.estado),
    ['removido', 'removido'],
  )
  assert.equal(readFileSync(join(conta, 'settings.json'), 'utf8'), '{\n  "model": "y"\n}\n')
})

test('claude: settings.json da conta que é link para o principal conta uma vez', t => {
  const { home, arq } = setup('claude', terceiros())
  const conta = join(home, '.claude-2')
  if (!comLink(arq, join(conta, 'settings.json'))) return t.skip('sem permissão de link')
  const r = instalarHooks(home, ['claude'], LAN, { claude: [conta] })
  assert.equal(r.length, 1)
  assert.equal(JSON.parse(readFileSync(arq, 'utf8')).hooks.PreToolUse.length, 2)
  assert.equal(removerHooks(home, ['claude'], { claude: [conta] }).length, 1)
})

for (const ag of ['claude', 'codex'] as const) {
  test(`${ag}: remover apaga o arquivo que o próprio Instalar criou, com a marca e a cópia vazia; arquivo que existia volta ao original`, () => {
    const novo = setup(ag)
    const [r] = instalarHooks(novo.home, [ag], LAN)
    assert.equal(existsSync(`${r.backup!}.ausente`), true)
    removerHooks(novo.home, [ag])
    assert.equal(existsSync(novo.arq), false)
    assert.equal(existsSync(r.backup!), false)
    assert.equal(existsSync(`${r.backup!}.ausente`), false)

    const vazio = setup(ag, '{}')
    instalarHooks(vazio.home, [ag], LAN)
    removerHooks(vazio.home, [ag])
    assert.equal(readFileSync(vazio.arq, 'utf8'), '{}')
  })

  test(`${ag}: grupo nosso diferente do esperado (outro timeout ou lançador) é desatualizado; Instalar troca o grupo`, () => {
    const { home, arq } = setup(ag)
    instalarHooks(home, [ag], LAN)
    assert.equal(estadoHooks(home, LAN).find(e => e.agente === ag)?.estado, 'instalado')
    assert.equal(estadoHooks(home, '/outro/agent-pool').find(e => e.agente === ag)?.estado, 'desatualizado')
    const obj = JSON.parse(readFileSync(arq, 'utf8'))
    obj.hooks.PreToolUse[0].hooks[0].timeout = 10
    writeFileSync(arq, JSON.stringify(obj))
    assert.equal(estadoHooks(home, LAN).find(e => e.agente === ag)?.estado, 'desatualizado')
    assert.equal(instalarHooks(home, [ag], LAN)[0].estado, 'instalado')
    assert.equal(estadoHooks(home, LAN).find(e => e.agente === ag)?.estado, 'instalado')
  })
}

function comPlataforma<T>(plataforma: NodeJS.Platform, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: plataforma })
  try {
    return fn()
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
}

test('codex no Windows: comando com & ; o grupo antigo sem & é desatualizado, o Instalar troca e o Remover reconhece as duas formas', () => {
  comPlataforma('win32', () => {
    const antigo = { hooks: [{ type: 'command', command: `"${LAN}" hook codex`, timeout: 15 }] }
    const { home, arq } = setup('codex', JSON.stringify({ hooks: { PreToolUse: [antigo] } }))
    assert.equal(estadoHooks(home, LAN).find(e => e.agente === 'codex')?.estado, 'desatualizado')
    assert.equal(instalarHooks(home, ['codex'], LAN)[0].estado, 'instalado')
    assert.equal(JSON.parse(readFileSync(arq, 'utf8')).hooks.PreToolUse[0].hooks[0].command, `& "${LAN}" hook codex`)
    assert.equal(estadoHooks(home, LAN).find(e => e.agente === 'codex')?.estado, 'instalado')
    assert.equal(removerHooks(home, ['codex'])[0].estado, 'removido')

    const velho = setup('codex', JSON.stringify({ hooks: { PreToolUse: [antigo] } }))
    assert.equal(removerHooks(velho.home, ['codex'])[0].estado, 'removido')
  })
})

test('fora do Windows o comando do Codex segue sem &', () => {
  comPlataforma('linux', () => {
    const { home, arq } = setup('codex')
    instalarHooks(home, ['codex'], LAN)
    assert.equal(JSON.parse(readFileSync(arq, 'utf8')).hooks.PreToolUse[0].hooks[0].command, `"${LAN}" hook codex`)
  })
})
