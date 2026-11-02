import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { estadoHooks, instalarHooks, pastasDasContas, removerHooks } from '../src/hooks/comum.ts'
import { cfg, conta } from './helpers/pool.ts'
import { hashConfianca } from '../src/hooks/codex.ts'
import { guardarCasaReal } from './helpers/casa.ts'

guardarCasaReal()

const LAN = '/h/.agents/bin/agent-pool'
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
const terceiros = () => JSON.stringify({
  model: 'x',
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash outro.sh' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'fim.sh' }] }]
  }
}, null, 2) + '\n'

for (const ag of ['claude', 'codex'] as const) {
  test(`${ag}: primeira instalação registra a ausência original antes de criar hooks`, () => {
    const { home } = setup(ag)
    const [r] = instalarHooks(home, [ag], LAN)
    assert.equal(r.estado, 'instalado')
    assert.ok(r.backup)
    assert.equal(readFileSync(r.backup!, 'utf8'), '')
    assert.equal(existsSync(r.backup! + '.ausente'), true)
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
      assert.equal(g[0].hooks[0].command, `"${LAN}" hook ${ag}`)
      assert.equal(estadoHooks(home).find((e) => e.agente === ag)?.estado, 'instalado')
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

  test(`${ag}: JSON inválido não é tocado e reporta erro`, () => {
    const lixo = '{ "hooks": [oops'
    const { home, arq } = setup(ag, lixo)
    assert.equal(instalarHooks(home, [ag], LAN)[0].estado, 'erro')
    assert.equal(removerHooks(home, [ag])[0].estado, 'erro')
    assert.equal(estadoHooks(home).find((e) => e.agente === ag)?.estado, 'erro')
    assert.equal(readFileSync(arq, 'utf8'), lixo)
    assert.equal(existsSync(join(home, '.agents')), false)
  })
}

test('codex: grupo sem matcher e timeout 10; claude: matcher Bash|PowerShell', () => {
  const { home } = setup('claude')
  instalarHooks(home, ['claude', 'codex'], LAN)
  const c = JSON.parse(readFileSync(join(home, ...caminho.claude), 'utf8')).hooks.PreToolUse[0]
  const x = JSON.parse(readFileSync(join(home, ...caminho.codex), 'utf8')).hooks.PreToolUse[0]
  assert.equal(c.matcher, 'Bash|PowerShell')
  assert.equal(x.matcher, undefined)
  assert.equal(x.hooks[0].timeout, 10)
})

test('hash de confiança confere com o valor calculado à mão (json.dumps do Python)', () => {
  assert.equal(hashConfianca(`"${LAN}" hook codex`, 10), 'sha256:d12893fed7d5ab81a54c143e4f1f13a63d47fefc5dab802adc39af96c9581977')
  assert.equal(hashConfianca('"/h/á/agent-pool" hook codex', 10), 'sha256:e99383287298cdf97b03cf0739627759abd9c37de87181099964e290c0ed28e4')
})

test('codex: confiança no config.toml, no índice do grupo, idempotente e removida byte a byte', () => {
  const orig = "model = \"x\"\n\n[hooks.state.'outro:pre_tool_use:0:0']\nenabled = true\n"
  const { home, arq } = setup('codex', terceiros())
  const toml = join(home, '.codex', 'config.toml')
  writeFileSync(toml, orig)
  const [r] = instalarHooks(home, ['codex'], LAN)
  assert.equal(r.estado, 'instalado')
  const t = readFileSync(toml, 'utf8')
  const hash = 'sha256:d12893fed7d5ab81a54c143e4f1f13a63d47fefc5dab802adc39af96c9581977'
  const cab = (c: string) => `[hooks.state.'${c}:pre_tool_use:1:0']\nenabled = true\ntrusted_hash = "${hash}"`
  const caminho = arq.replace(/\\/g, '/')
  assert.ok(t.includes(cab(caminho)))
  if (/^[A-Za-z]:\//.test(caminho)) assert.ok(t.includes(cab(caminho.replace(/\//g, '\\'))))
  assert.equal(readFileSync(join(home, '.agents', 'agent-pool', 'state', 'backup', 'codex-config-config.toml.orig'), 'utf8'), orig)
  assert.equal(instalarHooks(home, ['codex'], LAN)[0].estado, 'ja')
  assert.equal(readFileSync(toml, 'utf8'), t)
  // lançador novo troca o hash sem deixar bloco velho
  instalarHooks(home, ['codex'], '/outro/agent-pool')
  const t2 = readFileSync(toml, 'utf8')
  assert.ok(!t2.includes(hash) && t2.includes(hashConfianca('"/outro/agent-pool" hook codex', 10)))
  removerHooks(home, ['codex'])
  assert.equal(readFileSync(toml, 'utf8'), orig)
  assert.equal(readFileSync(arq, 'utf8'), terceiros())
})

test('conta inativa: remover alcança a pasta de config dela', () => {
  const { home } = setup('claude')
  const c = cfg([conta('a', { config: '~/.claude-2', ativo: false })])
  const pastas = pastasDasContas(c)
  instalarHooks(home, ['claude'], LAN, pastas)
  const dois = join(home, '.claude-2', 'settings.json')
  assert.ok(readFileSync(dois, 'utf8').includes('hook claude'))
  removerHooks(home, ['claude'], pastas)
  assert.ok(!readFileSync(dois, 'utf8').includes('hook claude'))
})

test('codex: grupo de terceiro depois do nosso mantém a confiança ao reinstalar e ao remover', () => {
  const nossoVelho = { hooks: [{ type: 'command', command: '"/velho/agent-pool" hook codex', timeout: 10 }] }
  const terceiro = { hooks: [{ type: 'command', command: 'guarda.sh' }] }
  const { home, arq } = setup('codex', JSON.stringify({ hooks: { PreToolUse: [nossoVelho, terceiro] } }))
  const toml = join(home, '.codex', 'config.toml')
  const chave = (n: number) => `[hooks.state.'${arq.replace(/\\/g, '/')}:pre_tool_use:${n}:0']`
  writeFileSync(toml, `${chave(1)}\nenabled = true\ntrusted_hash = "sha256:terceiro"\n`)
  instalarHooks(home, ['codex'], LAN)
  const grupos = JSON.parse(readFileSync(arq, 'utf8')).hooks.PreToolUse
  assert.equal(grupos[1].hooks[0].command, 'guarda.sh')
  assert.ok(grupos[0].hooks[0].command.includes(LAN))
  let t = readFileSync(toml, 'utf8')
  assert.ok(t.includes(`${chave(1)}\nenabled = true\ntrusted_hash = "sha256:terceiro"`))
  assert.ok(t.includes(chave(0)))
  removerHooks(home, ['codex'])
  t = readFileSync(toml, 'utf8')
  assert.ok(t.includes(`${chave(0)}\nenabled = true\ntrusted_hash = "sha256:terceiro"`))
  assert.ok(!t.includes(chave(1)))
})

test('codex: sem config.toml prévio, remover não deixa resíduo; hook de terceiros com campo igual não é confundido', () => {
  const { home } = setup('codex')
  const toml = join(home, '.codex', 'config.toml')
  instalarHooks(home, ['codex'], LAN)
  assert.match(readFileSync(toml, 'utf8'), /trusted_hash/)
  removerHooks(home, ['codex'])
  assert.equal(readFileSync(toml, 'utf8').trim(), '')
  assert.equal(estadoHooks(home).find((e) => e.agente === 'codex')?.estado, 'ausente')
})

// --- links, TOML do Codex e pastas de contas ---
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
  test(`${ag}: arquivo que é link continua link e o alvo recebe o hook`, (t) => {
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

const tabelas = (toml: string) => [...toml.matchAll(/^\[hooks\.state\.(.+)\]$/gm)].map((m) => m[1])

test('codex: confiança de outro hash no mesmo índice vira uma tabela só, com o nosso hash', () => {
  const { home, arq } = setup('codex', '{}')
  const toml = join(home, '.codex', 'config.toml')
  const caminho = arq.replace(/\\/g, '/')
  const grafias = /^[A-Za-z]:\//.test(caminho) ? [caminho, caminho.replace(/\//g, '\\')] : [arq]
  const velho = grafias.map((c) => `[hooks.state.'${c}:pre_tool_use:0:0']\nenabled = true\ntrusted_hash = "sha256:velho"\n`).join('\n')
  writeFileSync(toml, `model = "x"\n\n${velho}\n[outra]\nx = 1\n`)
  assert.equal(instalarHooks(home, ['codex'], LAN)[0].estado, 'instalado')
  const t = readFileSync(toml, 'utf8')
  assert.equal(tabelas(t).length, grafias.length)
  assert.ok(!t.includes('sha256:velho'))
  assert.ok(t.includes(hashConfianca(`"${LAN}" hook codex`, 10)))
  assert.ok(t.includes('[outra]\nx = 1'))
  assert.equal(instalarHooks(home, ['codex'], LAN)[0].estado, 'ja')
  removerHooks(home, ['codex'])
  assert.equal(readFileSync(toml, 'utf8'), `model = "x"\n\n[outra]\nx = 1\n`)
})

test('codex: caminho com apóstrofo gera cabeçalho em string básica válida', () => {
  const base = mkdtempSync(join(tmpdir(), 'hooks-'))
  const home = join(base, "O'Brien")
  mkdirSync(home)
  instalarHooks(home, ['codex'], LAN)
  const toml = join(home, '.codex', 'config.toml')
  const hs = tabelas(readFileSync(toml, 'utf8'))
  assert.ok(hs.length >= 1)
  for (const h of hs) {
    assert.match(h, /^"(?:[^"\\]|\\.)*"$/, h)
    assert.ok(JSON.parse(h).includes("O'Brien"))
  }
  assert.equal(instalarHooks(home, ['codex'], LAN)[0].estado, 'ja')
  removerHooks(home, ['codex'])
  assert.equal(readFileSync(toml, 'utf8').trim(), '')
})

test('claude: pasta de config de conta ganha o hook; remover limpa as duas; backup por pasta', () => {
  const { home } = setup('claude', terceiros())
  const conta = join(home, '.claude-2')
  mkdirSync(conta)
  writeFileSync(join(conta, 'settings.json'), '{\n  "model": "y"\n}\n')
  const pastas = { claude: ['~/.claude-2'] }
  const r = instalarHooks(home, ['claude'], LAN, pastas)
  assert.deepEqual(r.map((x) => x.estado), ['instalado', 'instalado'])
  assert.notEqual(r[0].backup, r[1].backup)
  assert.equal(readFileSync(r[1].backup!, 'utf8'), '{\n  "model": "y"\n}\n')
  for (const f of [join(home, '.claude', 'settings.json'), join(conta, 'settings.json')]) {
    assert.ok(JSON.stringify(JSON.parse(readFileSync(f, 'utf8')).hooks.PreToolUse).includes('hook claude'), f)
  }
  assert.deepEqual(estadoHooks(home, pastas).filter((e) => e.agente === 'claude').map((e) => e.estado), ['instalado', 'instalado'])
  assert.deepEqual(removerHooks(home, ['claude'], pastas).map((x) => x.estado), ['removido', 'removido'])
  assert.equal(readFileSync(join(conta, 'settings.json'), 'utf8'), '{\n  "model": "y"\n}\n')
})

test('claude: settings.json da conta que é link para o principal conta uma vez', (t) => {
  const { home, arq } = setup('claude', terceiros())
  const conta = join(home, '.claude-2')
  if (!comLink(arq, join(conta, 'settings.json'))) return t.skip('sem permissão de link')
  const r = instalarHooks(home, ['claude'], LAN, { claude: [conta] })
  assert.equal(r.length, 1)
  assert.equal(JSON.parse(readFileSync(arq, 'utf8')).hooks.PreToolUse.length, 2)
  assert.equal(removerHooks(home, ['claude'], { claude: [conta] }).length, 1)
})
