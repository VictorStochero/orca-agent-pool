import { afterEach, assert, mockHost as criarHost, hostError, mount as montar, type TestPanel, test } from 'orca/testing'
import type { Estado, EstadoHookAgente, Requisitos } from '../protocol'
import { estadoComAlertas, estadoExemplo } from './fixtures'
import * as panel from './panel'
import { abrir as abrirLinha, cabecalho, celula, chaves, lista, nos, rotuloDe, semZwsp, tem, valorDe, ZWSP } from './tabela-teste'
import { textosPara } from './textos'

const mockHost = (opcoes: Parameters<typeof criarHost>[0] = {}) =>
  criarHost({
    ...opcoes,
    requests: {
      'hooks.estado': () => [],
      ...opcoes.requests,
    },
  })
const mount = (modulo: Parameters<typeof montar>[0], opcoes: Parameters<typeof montar>[1] = {}) =>
  montar(modulo, { locale: 'pt-BR', ...opcoes })

let view: TestPanel | undefined
afterEach(() => view?.unmount())

const POOL = lista('Contas do pool')
/** `codex` cadastrada à mão: só conta manual tem "Remover do pool". */
const codexManual: Estado = {
  ...estadoExemplo,
  pool: {
    ...estadoExemplo.pool,
    contas: estadoExemplo.pool.contas.map(c => (c.nome === 'codex' ? { ...c, origem: 'manual' as const } : c)),
  },
}

const ABAS = ['fila', 'pool', 'contas', 'imposicao', 'instalacao', 'painel']
/**
 * Configurações começa recolhida e é dividida em abas: abre e escolhe o assunto.
 * Com a chave de uma linha das tabelas (não é nome de aba), clica a linha.
 */
async function abrir(v: TestPanel, alvo?: string) {
  if (alvo && !ABAS.includes(alvo)) return abrirLinha(v, alvo)
  await v.toggle({ label: 'Configurações' })
  if (alvo) await v.select({ label: 'Assuntos das configurações' }, alvo)
}
const FILA = lista('Testes na fila')
const linhasDe = (l: { label: string }) => chaves(view!, l.label)

/** Requisitos na tela, pelo título de cada linha recolhível (✓/✗ + nome), devolvidos como ids. */
function idsReq(v: TestPanel, locale = 'pt-BR'): string[] {
  const nomes = Object.entries(textosPara(locale).requisitos.nomes)
  return v
    .findAll({ type: 'Collapsible' })
    .map(c => String(c.props.title))
    .filter(x => /^[✓✗] /.test(x))
    .map(x => nomes.find(([, n]) => x.slice(2) === n)?.[0] ?? x)
}
/** Abre a linha do requisito (o botão Instalar só aparece com ela aberta). */
const abrirReq = (v: TestPanel, id: keyof ReturnType<typeof textosPara>['requisitos']['nomes'], ok = false, locale = 'pt-BR') =>
  v.toggle({ label: `${ok ? '✓' : '✗'} ${textosPara(locale).requisitos.nomes[id]}` })

test('fixture sem login não fornece cotas antigas', () => {
  const cota = estadoComAlertas.pool.contas.find(c => c.nome === 'work')!.cota!
  assert.equal(cota.curta, null)
  assert.equal(cota.longa, null)
})

for (const acao of ['ordem', 'remover']) {
  test(`recusa de ${acao} permanece visível na segunda conta`, async () => {
    view = await mount(panel, {
      host: mockHost({
        requests: {
          'estado.ler': () => codexManual,
          'config.gravar': () => {
            throw hostError('config_recusada', 'Gravação recusada')
          },
        },
      }),
    })
    await abrir(view, 'contas')
    await view.select({ label: 'Conta a configurar' }, 'codex')
    if (acao === 'ordem') await view.press({ type: 'IconButton', label: 'Subir' })
    else {
      await view.press({ text: 'Remover do pool' })
      await view.press({ text: 'Confirmar remoção' })
    }
    assert.equal(view.valueOf({ label: 'Conta a configurar' }), 'codex')
    assert.ok(view.find({ text: 'Gravação recusada' }))
  })
}

for (const [locale, fila, pool, config, imposicao, remover, reinstalar, ausencia, instalarHook] of [
  ['en', 'Queued tests', 'Pool accounts', 'Settings', 'Hooks', 'Remove hook', 'Reinstall', 'Not installed', 'Install hook'],
  ['pt-BR', 'Testes na fila', 'Contas do pool', 'Configurações', 'Hooks', 'Remover hook', 'Reinstalar', 'Ausente', 'Instalar hook'],
]) {
  const t = textosPara(locale)
  test(`${locale}: requisitos bloqueiam fila e pool; a linha recolhida só mostra o Instalar depois de aberta, com o que o item faz`, async () => {
    view = await mount(panel, {
      locale,
      host: mockHost({
        requests: {
          'requisitos.ler': () => ({
            ok: false,
            itens: [{ id: 'orchestration', ok: false, detalhe: { codigo: 'nao_instalada' }, instalar: true }],
          }),
        },
      }),
    })
    assert.deepEqual(idsReq(view, locale), ['orchestration'])
    assert.ok(
      view.find({
        type: 'Collapsible',
        label: `✗ ${t.requisitos.nomes.orchestration}`,
        text: new RegExp(`${t.requisitos.obrigatorio} · ${t.requisitos.falta}`),
      }),
    )
    assert.equal(view.find({ type: 'Button', text: t.requisitos.instalar }), null)
    await abrirReq(view, 'orchestration', false, locale)
    assert.ok(view.find({ text: t.requisitos.oQueFaz.orchestration }))
    assert.ok(view.find({ text: t.requisitos.porque.orchestration }))
    assert.ok(view.find({ type: 'Button', text: t.requisitos.instalar }))
    assert.equal(view.find(lista(fila)), null)
    assert.equal(view.find(lista(pool)), null)
  })

  test(`${locale}: atenção mantém ação de login e esconde cota velha`, async () => {
    view = await mount(panel, { locale, host: hostCom([], estadoComAlertas) })
    assert.ok(view.find({ type: 'Callout', text: new RegExp(t.atencao) }))
    assert.ok(view.find({ type: 'Code', text: /claude auth login/ }))
    assert.equal(tem(view, lista(pool), /84%/), null)
  })

  test(`${locale}: fila expande o comando do teste`, async () => {
    view = await mount(panel, { locale, host: hostCom() })
    await abrir(view, 'p4242')
    assert.ok(tem(view, lista(fila), new RegExp(t.fila.comando)))
    assert.ok(tem(view, lista(fila), /runner tests\/X.php/))
  })

  test(`${locale}: fila expandida mostra progresso, última saída, última linha e linhas de saída em duas colunas`, async () => {
    view = await mount(panel, { locale, host: hostCom() })
    await abrir(view, 'p4242')
    const rotulo = (i: number) => rotuloDe(view!, 'p4242', i)
    const valor = (i: number) => valorDe(view!, 'p4242', i)
    // a barra inteira, sem corte, com o total e as duas contagens
    assert.deepEqual([rotulo(0), valor(0)], [t.fila.progresso, `▓▓▓▓▓░░░░░ 52% (63/120) · ${t.fila.passaramFalharam(61, 2)}`])
    assert.equal(rotulo(1), t.fila.ultimaSaida)
    assert.ok(view.find({ testId: 'p4242#1:valor' }) && view.find({ type: 'RelativeTime' }))
    assert.deepEqual([rotulo(2), valor(2)], [t.fila.ultimaLinha, '... 63 / 120 ( 52%)'])
    assert.deepEqual([rotulo(3), valor(3)], [t.fila.linhasSaida, '12'])
    for (let i = 0; i < 8; i++) assert.notEqual(valor(i), '–', `detalhe ${i} sem célula vazia`)
    assert.equal(view.find({ testId: 'p4242#8:rotulo' }), null)
  })

  test(`${locale}: detalhes separados por divisória e com ZWSP só no valor exibido`, async () => {
    view = await mount(panel, { locale, host: hostCom() })
    await abrir(view, 'p4242')
    // uma divisória entre cada par de itens (8 itens, 7 divisórias), nenhuma antes do primeiro
    assert.deepEqual(
      nos(view)
        .filter(n => n.type === 'Separator' && /^p4242#\d+:divisoria$/.test(n.key ?? ''))
        .map(n => n.key),
      [1, 2, 3, 4, 5, 6, 7].map(i => `p4242#${i}:divisoria`),
    )
    const bruto = view.find({ testId: 'p4242#4:valor' })!.text
    assert.ok(bruto.includes(ZWSP) && !bruto.includes(ZWSP.repeat(2)))
    assert.equal(semZwsp(bruto), 'mysql 127.0.0.1:3308/app_test') // o texto à vista é o mesmo
    assert.equal(view.find({ testId: 'p4242.projeto' })!.text.includes(ZWSP), false) // a célula da linha não leva ZWSP
    assert.equal(view.find({ testId: 'p4242#4' })!.props.align, 'start') // rótulo no topo do valor
  })

  test(`${locale}: teste em execução sem nenhuma saída mostra "nenhuma ainda"`, async () => {
    const e: Estado = {
      ...estadoExemplo,
      fila: { ...estadoExemplo.fila, testes: [{ ...estadoExemplo.fila.testes[0], saida: null }] },
    }
    view = await mount(panel, { locale, host: hostCom([], e) })
    await abrir(view, 'p4242')
    assert.deepEqual([rotuloDe(view, 'p4242', 0), valorDe(view, 'p4242', 0)], [t.fila.ultimaSaida, t.fila.nenhumaAinda])
    assert.equal(tem(view, lista(fila), new RegExp(t.fila.progresso)), null)
  })

  test(`${locale}: campos da fila por modo: projeto só vagas por projeto; global e banco só vagas; o modo marcado vale antes de salvar`, async () => {
    const gravados: unknown[] = []
    view = await mount(panel, { locale, host: hostCom(gravados) }) // o estado de exemplo está no modo global
    await view.toggle({ label: config })
    await view.select({ label: t.configuracoes.assuntos }, 'fila')
    const campo = (k: 'vagas' | 'vagas_projeto') => view!.find({ type: 'Input', label: t.fila.campos[k] })
    const sempre = [t.fila.campos.teto, t.fila.campos.processos, t.fila.campos.sem_saida_min]
    const temSempre = () => sempre.every(l => view!.find({ type: 'Input', label: l }))
    assert.ok(campo('vagas') && !campo('vagas_projeto') && temSempre())
    await view.select({ label: `${t.fila.campos.modo}: ${t.fila.modos.projeto}` }, 'projeto')
    assert.ok(!campo('vagas') && campo('vagas_projeto') && temSempre())
    await view.select({ label: `${t.fila.campos.modo}: ${t.fila.modos.banco}` }, 'banco')
    assert.ok(campo('vagas') && !campo('vagas_projeto') && temSempre())
    assert.ok(view.find({ type: 'Checkbox', label: /^(Apagar os bancos|Drop the)/ }))
    await view.press({ type: 'Button', text: t.salvar })
    assert.deepEqual(gravados, [{ 'fila.modo': 'banco' }]) // só o editado
  })

  test(`${locale}: sem pct, o progresso diz quantos passaram e quantos falharam`, async () => {
    const e: Estado = {
      ...estadoExemplo,
      fila: {
        ...estadoExemplo.fila,
        testes: [
          {
            ...estadoExemplo.fila.testes[0],
            saida: { ts: 1793650470000, linha: null, linhas: 3, pct: null, feitos: 88, total: null, passou: 86, falhou: 2 },
          },
        ],
      },
    }
    view = await mount(panel, { locale, host: hostCom([], e) })
    await abrir(view, 'p4242')
    assert.equal(valorDe(view, 'p4242', 0), t.fila.passaramFalharam(86, 2))
    assert.equal(tem(view, lista(fila), new RegExp(t.fila.ultimaLinha)), null)
    // sem falhas a parte "⨯ 0" continua à mostra; pytest (sem contagem) fica só com a barra
    const sem = (passou: number | null, falhou: number | null, pct: number | null): Estado => ({
      ...e,
      fila: {
        ...e.fila,
        testes: [{ ...e.fila.testes[0], saida: { ts: 1, linha: null, linhas: 1, pct, feitos: null, total: null, passou, falhou } }],
      },
    })
    await view.unmount()
    view = await mount(panel, { locale, host: hostCom([], sem(5, 0, null)) })
    await abrir(view, 'p4242')
    assert.equal(valorDe(view, 'p4242', 0), t.fila.passaramFalharam(5, 0))
    await view.unmount()
    view = await mount(panel, { locale, host: hostCom([], sem(null, null, 45)) })
    await abrir(view, 'p4242')
    assert.equal(valorDe(view, 'p4242', 0), '▓▓▓▓░░░░░░ 45%')
  })

  test(`${locale}: configurações da fila têm o campo sem_saida_min e o texto do alerta teste_sem_saida`, async () => {
    const gravados: unknown[] = []
    view = await mount(panel, { locale, host: hostCom(gravados) })
    await view.toggle({ label: config })
    await view.select({ label: t.configuracoes.assuntos }, 'fila')
    await view.type({ label: t.fila.campos.sem_saida_min }, '9', { replace: true })
    await view.press({ type: 'Button', text: t.salvar })
    assert.deepEqual(gravados, [{ 'fila.sem_saida_min': '9' }])
    assert.match(
      t.alertas.teste_sem_saida(123, 'marco1', 7),
      locale === 'en' ? /no output for 7 min \(pid 123\) in marco1/ : /sem saída há 7 min \(pid 123\) em marco1/,
    )
  })

  test(`${locale}: pool identifica conta desativada`, async () => {
    view = await mount(panel, { locale, host: hostCom() })
    assert.ok(tem(view, lista(pool), new RegExp(t.pool.naoUtilizada)))
    await abrir(view, 'claude-abcdef12')
    assert.ok(tem(view, lista(pool), new RegExp(t.pool.naoUtilizadaDetalhe)))
    await abrir(view, 'main')
    assert.ok(tem(view, lista(pool), locale === 'en' ? /Writer, Reviewer/ : /Escritor, Revisor/))
  })

  for (const aba of ['fila', 'pool', 'contas', 'painel'] as const) {
    test(`${locale}: configuração ${aba} editável`, async () => {
      const gravados: unknown[] = []
      view = await mount(panel, { locale, host: hostCom(gravados) })
      await view.toggle({ label: config })
      await view.select({ label: t.configuracoes.assuntos }, aba)
      if (aba === 'fila') {
        await view.type({ label: t.fila.campos.vagas }, '7', { replace: true })
        await view.press({ type: 'Button', text: t.salvar })
        assert.deepEqual(gravados, [{ 'fila.vagas': '7' }])
      } else if (aba === 'pool') {
        await view.select({ label: t.pool.escolha }, 'ordem')
        await view.press({ type: 'Button', text: t.salvar })
        assert.deepEqual(gravados, [{ 'pool.escolha': 'ordem' }])
      } else if (aba === 'contas') {
        assert.ok(view.find({ type: 'Checkbox', label: t.pool.naoUtilizar }))
        assert.ok(view.find({ type: 'IconButton', label: t.pool.descer }))
        assert.equal(view.find({ label: t.pool.novaNome }), null) // o formulário de cadastro fica na outra subaba
        await view.select({ label: t.configuracoes.contasAbas.assuntos }, 'cadastrar')
        assert.equal(view.find({ type: 'Checkbox', label: t.pool.naoUtilizar }), null)
        await view.type({ label: t.pool.novaNome }, 'custom')
        await view.type({ label: t.pool.comandoCli }, 'claude')
        await view.press({ type: 'Button', text: t.pool.novaCriar })
        assert.deepEqual(gravados, [{ 'conta.custom.adicionar': 'auto', 'conta.custom.comando': 'claude' }])
      } else {
        await view.type({ label: t.painel.intervalo }, '1', { replace: true })
        await view.press({ type: 'Button', text: t.salvar })
        assert.ok(view.find({ text: t.painel.invalido(15, 3600) }))
      }
      assert.deepEqual(view.errors, [])
      assert.deepEqual(view.warnings, [])
      assert.deepEqual(view.refusals, [])
    })
  }

  test(`${locale}: fila, pool e configurações traduzidos`, async () => {
    view = await mount(panel, { host: hostCom(), locale })
    assert.equal(chaves(view, fila).length, 3)
    assert.equal(chaves(view, pool).length, 3)
    assert.ok(view.find({ type: 'Collapsible', label: config }))
    assert.equal(view.find({ type: 'Card' }), null) // as seções usam o cartão próprio (Secao), mais justo que o Card
    assert.equal(view.find({ text: new RegExp(`^${imposicao}$`) }), null) // o bloco solto de hooks saiu do corpo
    assert.ok(view.find({ type: 'Box', text: new RegExp(config) })) // Configurações ganha o cartão das outras seções
    assert.equal(view.find({ type: 'Button', text: reinstalar }), null) // recolhida: os hooks só aparecem dentro dela
    await view.toggle({ label: config })
    await view.select({ label: t.configuracoes.assuntos }, 'imposicao')
    assert.ok(view.find({ text: t.imposicao.descricao }))
  })

  test(`${locale}: hooks removem e reinstalam por agente com estado atualizado`, async () => {
    const chamadas: unknown[] = []
    let lista: EstadoHookAgente[] = [
      { agente: 'claude', estado: 'instalado' },
      { agente: 'codex', estado: 'erro', detalhe: 'JSON inválido' },
    ]
    view = await mount(panel, {
      locale,
      host: mockHost({
        requests: {
          'estado.ler': () => estadoExemplo,
          'hooks.estado': () => lista,
          'hooks.remover': (entrada: { agente: string }) => {
            chamadas.push(['remover', entrada])
            lista = [{ agente: 'claude', estado: 'ausente' }]
            return lista
          },
          'hooks.reinstalar': (entrada: { agente: string }) => {
            chamadas.push(['reinstalar', entrada])
            lista = [{ agente: 'claude', estado: 'instalado' }]
            return lista
          },
        },
      }),
    })
    await view.toggle({ label: config })
    await view.select({ label: t.configuracoes.assuntos }, 'imposicao')
    assert.ok(view.find({ text: 'JSON inválido' }))
    await view.press({ type: 'Button', text: remover })
    assert.ok(view.find({ text: ausencia }))
    await view.press({ type: 'Button', text: instalarHook })
    assert.deepEqual(chamadas, [
      ['remover', { agente: 'claude' }],
      ['reinstalar', { agente: 'claude' }],
    ])
    assert.equal(view.find({ text: ausencia }), null)
    assert.deepEqual(view.errors, [])
    assert.deepEqual(view.warnings, [])
    assert.deepEqual(view.refusals, [])
  })

  test(`${locale}: hook desatualizado pode ser removido sem reinstalar`, async () => {
    const chamadas: unknown[] = []
    view = await mount(panel, {
      locale,
      host: mockHost({
        requests: {
          'estado.ler': () => estadoExemplo,
          'hooks.estado': () => [{ agente: 'codex', estado: 'desatualizado' as const }],
          'hooks.remover': (entrada: { agente: string }) => {
            chamadas.push(entrada)
            return [{ agente: 'codex', estado: 'ausente' as const }]
          },
        },
      }),
    })
    await view.toggle({ label: config })
    await view.select({ label: t.configuracoes.assuntos }, 'imposicao')
    await view.press({ type: 'Button', text: remover })
    assert.deepEqual(chamadas, [{ agente: 'codex' }])
  })
}

function hostCom(gravados: unknown[] = [], estado: Estado = estadoExemplo) {
  return mockHost({
    requests: {
      'estado.ler': () => estado,
      'config.gravar': ({ valores }) => {
        gravados.push(valores)
        return estado
      },
    },
  })
}

test('remover hook na aba Hooks volta a travar o painel em Requisitos, com a linha dos hooks listando o arquivo a gravar', async () => {
  let removido = false
  const req = (): Requisitos =>
    removido
      ? {
          ok: false,
          itens: [
            {
              id: 'hooks',
              ok: false,
              detalhe: { codigo: 'hooks', agentes: [{ agente: 'claude', situacao: 'ausente' }] },
              instalar: true,
              arquivos: ['~/.claude/settings.json'],
            },
          ],
        }
      : tudoOk
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'requisitos.ler': req,
        'hooks.estado': () => [{ agente: 'claude', estado: removido ? 'ausente' : 'instalado' }],
        'hooks.remover': () => {
          removido = true
          return [{ agente: 'claude', estado: 'ausente', arquivos: ['~/.claude/settings.json'] }]
        },
        'estado.ler': () => estadoExemplo,
      },
    }),
  })
  await abrir(view, 'imposicao')
  await view.press({ type: 'Button', text: 'Remover hook' })
  assert.equal(view.find(POOL), null)
  assert.deepEqual(idsReq(view), ['hooks'])
  await abrirReq(view, 'hooks')
  assert.ok(view.find({ text: /claude: ausente/ }))
  assert.ok(view.find({ type: 'Code', text: '~/.claude/settings.json' }))
  assert.ok(view.find({ type: 'Button', text: 'Instalar' }))
})

test('Desinstalar pede confirmação, chama o worker e avisa que falta remover o plugin no Orca', async () => {
  const chamadas: string[] = []
  let desinstalado = false
  const vazio: Requisitos = { ok: false, itens: [{ id: 'lancador', ok: false, detalhe: { codigo: 'nao_instalado' }, instalar: true }] }
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'requisitos.ler': () => (desinstalado ? vazio : tudoOk),
        desinstalar: () => {
          chamadas.push('desinstalar')
          desinstalado = true
          return { ok: true as const }
        },
        'estado.ler': () => estadoExemplo,
      },
    }),
  })
  await abrir(view, 'instalacao')
  await view.press({ type: 'Button', text: 'Desinstalar tudo' })
  assert.deepEqual(chamadas, []) // o primeiro clique só arma
  await view.press({ type: 'Button', text: 'Confirmar: remover tudo' })
  assert.deepEqual(chamadas, ['desinstalar'])
  assert.ok(view.find({ text: 'Tudo removido. Agora remova o plugin em Configurações → Plugins do Orca.' }))
  assert.deepEqual(idsReq(view), ['lancador'])
})

test('Desinstalar recusado mostra o erro traduzido e não sai da tela', async () => {
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'requisitos.ler': () => tudoOk,
        desinstalar: () => {
          throw hostError('hooks_falhou', '/h/.claude: pretooluse_invalido')
        },
        'estado.ler': () => estadoExemplo,
      },
    }),
  })
  await abrir(view, 'instalacao')
  await view.press({ type: 'Button', text: 'Desinstalar tudo' })
  await view.press({ type: 'Button', text: 'Confirmar: remover tudo' })
  assert.ok(view.find({ text: /Não foi possível alterar o hook: \/h\/\.claude: "hooks\.PreToolUse" inválido/ }))
  assert.ok(view.find({ type: 'Button', text: 'Desinstalar tudo' }))
})

test('falha nos hooks preserva o estado e permite tentar de novo', async () => {
  let falha = true
  let lista: EstadoHookAgente[] = [{ agente: 'codex', estado: 'instalado' }]
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'estado.ler': () => estadoExemplo,
        'hooks.estado': () => lista,
        'hooks.remover': () => {
          if (falha) throw hostError('hooks_erro', 'Arquivo inválido')
          lista = [{ agente: 'codex', estado: 'ausente' }]
          return lista
        },
      },
    }),
  })
  await abrir(view, 'imposicao')
  await view.press({ type: 'Button', text: 'Remover hook' })
  assert.ok(view.find({ text: 'Arquivo inválido' }))
  assert.ok(view.find({ text: 'Instalado' }))
  falha = false
  await view.press({ type: 'Button', text: 'Remover hook' })
  assert.ok(view.find({ text: 'Ausente' }))
  assert.equal(view.find({ text: 'Arquivo inválido' }), null)
})

for (const id of ['orchestration', 'skill', 'lancador', 'hooks'] as const) {
  test(`instala requisito ${id} pelo contrato final`, async () => {
    const instalados: unknown[] = []
    view = await mount(panel, {
      host: mockHost({
        requests: {
          'requisitos.ler': () => ({ ok: false, itens: [{ id, ok: false, detalhe: { codigo: 'nao_instalada' }, instalar: true }] }),
          'requisitos.instalar': entrada => {
            instalados.push(entrada)
            return { ok: true, itens: [] }
          },
        },
      }),
    })
    await abrirReq(view, id)
    await view.press({ type: 'Button', text: 'Instalar' })
    assert.deepEqual(instalados, [{ id }])
  })
}

test('instalar durante uma coleta em curso relê os requisitos ao fim dela e mostra o estado', async () => {
  const pendencia: Requisitos = { ok: false, itens: [{ id: 'skill', ok: false, detalhe: { codigo: 'nao_instalada' }, instalar: true }] }
  let liberarVelha: (r: Requisitos) => void = () => {}
  const forcadas: (boolean | undefined)[] = []
  let chamadas = 0
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'requisitos.ler': (entrada?: { forcar?: boolean }) => {
          forcadas.push(entrada?.forcar)
          // 1ª: pendência imediata; 2ª (Atualizar): presa até o fim da instalação; depois: tudo ok.
          if (++chamadas === 1) return pendencia
          if (chamadas === 2) return new Promise<Requisitos>(resolve => (liberarVelha = resolve))
          return tudoOk
        },
        'requisitos.instalar': () => tudoOk,
        'estado.ler': () => estadoExemplo,
      },
    }),
  })
  await abrirReq(view, 'skill')
  // Sem await: a leitura presa segura o press até ser liberada.
  const atualizando = view.press({ text: 'Atualizar' })
  await new Promise(r => setTimeout(r, 0))
  const instalando = view.press({ type: 'Button', text: 'Instalar' })
  await new Promise(r => setTimeout(r, 0))
  liberarVelha(pendencia) // a coleta antiga termina com a leitura de antes da instalação
  await Promise.all([atualizando, instalando])
  assert.ok(view.find(POOL))
  assert.equal(forcadas.at(-1), true)
})

test('nome de conta fora do padrão é recusado no painel, sem gravar', async () => {
  const gravados: unknown[] = []
  view = await mount(panel, { host: hostCom(gravados) })
  await abrir(view, 'contas')
  await view.select({ label: 'Assuntos das contas' }, 'cadastrar')
  await view.type({ label: 'Nome' }, 'Work')
  await view.type({ label: 'Comando do CLI' }, 'claude -p')
  await view.press({ type: 'Button', text: 'Adicionar conta' })
  assert.ok(view.find({ text: /Nome inválido/ }))
  assert.deepEqual(gravados, [])
})

test('editar comando da conta manual preserva o campo da nova conta', async () => {
  const gravados: unknown[] = []
  view = await mount(panel, { host: hostCom(gravados) })
  await abrir(view, 'contas')
  await view.type({ label: 'Comando do CLI da conta' }, 'claude -p', { replace: true })
  await view.select({ label: 'Assuntos das contas' }, 'cadastrar')
  assert.equal(view.valueOf({ label: 'Comando do CLI' }), '')
  await view.select({ label: 'Assuntos das contas' }, 'configurar')
  await view.press({ type: 'Button', text: 'Salvar' })
  assert.deepEqual(gravados, [{ 'conta.main.comando': 'claude -p' }])
})

// Painel estreito: a primeira coluna cresce e as demais dividem 60% em partes iguais, sem largura em pixels.
test('colunas das tabelas: a primeira cresce com mínimo próprio, as demais têm largura fixa em px; abaixo da soma a tabela rola', async () => {
  view = await mount(panel, { host: hostCom() })
  for (const [chavesCol, larguras] of [
    [
      ['projeto', 'fila', 'estado', 'ha'],
      [140, 130, 130, 70],
    ],
    [
      ['conta', 'vagas', 'sessoes', 'h5', 'semanal'],
      [170, 60, 70, 55, 75],
    ],
  ] as const) {
    const [primeira, ...demais] = chavesCol.map(c => view!.find({ testId: `cabecalho.${c}` })!.props)
    assert.deepEqual([primeira.grow, primeira.minWidth, primeira.width], [true, larguras[0], undefined])
    for (const [i, p] of demais.entries()) assert.deepEqual([p.width, p.shrink, p.grow], [larguras[i + 1], false, false])
  }
  assert.equal(view.find({ testId: 'cabecalho.semanal' })!.props.justify, 'end')
  // contêiner com rolagem horizontal e a largura mínima somando a seta e as colunas (nunca menos que a soma delas)
  assert.equal(nos(view).filter(n => n.props.scroll === 'x').length, 2)
  const minimas = nos(view).flatMap(n => (n.props.gap === 'none' && typeof n.props.minWidth === 'number' ? [n.props.minWidth] : []))
  assert.equal(minimas.length, 2)
  assert.ok(
    minimas.every(m => m >= 28 + 140 + 130 + 130 + 70),
    String(minimas),
  )
})

test('erro de leitura dos hooks aparece sem ocultar fila e pool e recupera no refresh', async () => {
  let falha = true
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'estado.ler': () => estadoExemplo,
        'hooks.estado': () => {
          if (falha) throw hostError('hooks_erro', 'JSON inválido')
          return [{ agente: 'codex', estado: 'instalado' }]
        },
      },
    }),
  })
  await abrir(view, 'imposicao')
  assert.ok(view.find({ text: 'Não foi possível ler os hooks.' }))
  assert.equal(linhasDe(POOL).length, 3)
  falha = false
  await view.press({ text: 'Atualizar' })
  assert.equal(view.find({ text: 'Não foi possível ler os hooks.' }), null)
  assert.ok(view.find({ text: 'Instalado' }))
})

for (const locale of ['pt', 'pt-PT', 'PT-br', 'fr-FR', '']) {
  test(`locale ${locale || 'vazio'} escolhe pt* ou inglês`, async () => {
    view = await mount(panel, { host: hostCom(), locale })
    const titulo = locale.toLowerCase().startsWith('pt') ? 'Pool de agentes e fila de testes' : 'Agent Pool & Test Queue'
    assert.ok(view.find({ type: 'Heading', text: titulo }))
  })
}

test('tabelas próprias: Testes na fila (Projeto · Fila · Estado · Há) e Contas do pool (Conta · Vagas · Sessões · 5h · Semanal), sem RAM, Workers nem origem', async () => {
  view = await mount(panel, { host: hostCom() })
  // cabeçalho em maiúsculas, nas regras do idioma do painel
  assert.deepEqual(cabecalho(view, ['projeto', 'fila', 'estado', 'ha']), ['PROJETO', 'FILA', 'ESTADO', 'HÁ'])
  assert.deepEqual(cabecalho(view, ['conta', 'vagas', 'sessoes', 'h5', 'semanal']), ['CONTA', 'VAGAS', 'SESSÕES', '5H', 'SEMANAL'])
  assert.deepEqual(linhasDe(FILA), ['p4242', 'p4120', 'p99']) // uma linha por teste, na ordem do backend; sem linha de teto
  assert.deepEqual(linhasDe(POOL), ['main', 'codex', 'claude-abcdef12'])
  assert.ok(view.find({ text: /1 em execução · 1 aguardando · teto 5 · Modo Global/ }))
  const fila = FILA
  for (const trecho of [/wt-um/, /wt-tres/, /Global/, /Em execução/, /Aguardando vaga/, /⚠ Parado/])
    assert.ok(tem(view, fila, trecho), String(trecho))
  assert.equal(view.find({ text: /Viva|\bVaga\b|Fila teto|Rodando agora/ }), null)
  assert.ok(view.find({ type: 'IconButton', label: /^Os testes esperam a vez numa fila/ }))
  assert.equal(view.find({ text: /Workers|curta|longa|origem|Origem/ }), null)
  assert.equal(view.find({ type: 'Heading', text: /RAM/ }), null)
  assert.ok(view.find({ type: 'RelativeTime' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.refusals, [])
})

test('tabela com contorno, divisória entre todas as linhas, linhas mais altas e a rolagem dentro do contorno', async () => {
  view = await mount(panel, { host: hostCom() })
  const todos = nos(view)
  assert.equal(todos.filter(n => n.props.border === true && n.props.radius === 'md').length, 2) // Fila e Pool
  // a rolagem fica dentro do contorno, que não rola (a borda não é cortada)
  const rolagens = todos.filter(n => n.props.scroll === 'x')
  assert.ok(rolagens.every(n => n.ancestrais.some(a => a.props.border === true && a.props.radius === 'md')))
  // uma divisória antes de cada linha: 3 na Fila e 3 no Pool (a primeira fecha o cabeçalho)
  assert.equal(todos.filter(n => n.type === 'Separator' && n.key?.endsWith('#divisoria')).length, 6)
  // cabeçalho e linhas com o mesmo respiro vertical: 2 cabeçalhos + 6 linhas
  assert.equal(todos.filter(n => n.type === 'Box' && n.props.paddingY === 'sm' && n.props.align === 'center').length, 8)
})

test('cartão da seção: padding e espaço entre título e conteúdo médios', async () => {
  view = await mount(panel, { host: hostCom() })
  const cartoes = view.findAll({ type: 'Box' }).filter(b => b.props.border === true && b.props.radius === 'lg')
  assert.ok(cartoes.length > 0)
  assert.ok(cartoes.every(c => c.props.padding === 'md' && c.props.gap === 'md'))
})

test('sem os componentes de layout que quebraram o desenho: Grid, Callout, Skeleton e Toolbar', async () => {
  view = await mount(panel, { host: hostCom() })
  for (const tipo of ['Grid', 'Callout', 'Skeleton', 'Toolbar']) assert.equal(view.findAll({ type: tipo }).length, 0, tipo)
})

test('fila: clicar abre os detalhes na própria tabela (onde roda, comando, pid, worktree), várias ficam abertas e o segundo clique recolhe', async () => {
  view = await mount(panel, { host: hostCom() })
  await abrir(view, 'p4242')
  assert.deepEqual(linhasDe(FILA), ['p4242', 'p4242#detalhes', 'p4120', 'p99'])
  // progresso, última saída, última linha, linhas, onde, comando, pid, worktree: rótulo e valor lado a lado
  const rotulos = (k: string, n: number) => Array.from({ length: n }, (_, i) => view!.find({ testId: `${k}#${i}:rotulo` })?.text)
  assert.deepEqual(rotulos('p4242', 8), [
    'Progresso',
    'Última saída',
    'Última linha',
    'Linhas de saída',
    'Onde roda',
    'Comando',
    'PID',
    'Worktree',
  ])
  assert.equal(view.find({ testId: 'p4242#8:rotulo' }), null)
  assert.equal(valorDe(view, 'p4242', 4), 'mysql 127.0.0.1:3308/app_test')
  assert.equal(valorDe(view, 'p4242', 5), 'runner tests/X.php') // valor inteiro, sem truncar
  // Cada clique alterna a linha e mantém as outras abertas.
  await abrir(view, 'p99')
  assert.deepEqual(linhasDe(FILA), ['p4242', 'p4242#detalhes', 'p4120', 'p99', 'p99#detalhes'])
  assert.deepEqual(rotulos('p99', 5), ['Situação', 'Onde roda', 'Comando', 'PID', 'Worktree']) // o parado traz a linha de Situação
  assert.ok(tem(view, FILA, /O processo terminou e deixou a vaga presa/))
  await abrir(view, 'p4242')
  assert.deepEqual(linhasDe(FILA), ['p4242', 'p4120', 'p99', 'p99#detalhes'])
  await abrir(view, 'p99')
  assert.deepEqual(linhasDe(FILA), ['p4242', 'p4120', 'p99'])
})

test('fila: a coluna Fila segue o modo (Global · Banco · Container · Geral · Projeto <nome>) e sem testes diz "Nenhum teste na fila"', async () => {
  const com = (modo: Estado['fila']['modo'], recursos: string[]): Estado => ({
    ...estadoExemplo,
    fila: {
      ...estadoExemplo.fila,
      modo,
      testes: recursos.map((recurso, i) => ({ ...estadoExemplo.fila.testes[0], pid: 10 + i, recurso })),
    },
  })
  const tabela = FILA
  view = await mount(panel, { host: hostCom([], com('banco', ['mysql 127.0.0.1:3307/app_test', 'container exec-1', 'geral'])) })
  for (const trecho of [/Banco 127\.0\.0\.1:3307\/app_test/, /Container/, /Geral/]) assert.ok(tem(view, tabela, trecho), String(trecho))
  assert.ok(view.find({ text: /Modo Por banco/ }))
  await view.unmount()
  view = await mount(panel, { host: hostCom([], com('projeto', ['projeto meu-projeto'])) })
  assert.ok(tem(view, tabela, /Projeto wt-um/)) // o projeto da linha, não o recurso
  assert.ok(view.find({ text: /Modo Por projeto/ }))
  await view.unmount()
  view = await mount(panel, { host: hostCom([], com('global', [])) })
  assert.ok(view.find({ text: 'Nenhum teste na fila' }))
  assert.equal(view.find(tabela), null)
})

test('pool: coluna Sessões com o número (ou –), nomes nos detalhes e total no resumo, sem RAM', async () => {
  view = await mount(panel, { host: hostCom() })
  assert.ok(view.find({ text: /Agentes 1\/4 · Sessões 2 · Escritor pelo ritmo da cota/ }))
  assert.equal(view.find({ text: /RAM mínima/ }), null)
  const sessoes = linhasDe(POOL).map(k => celula(view!, k, 'sessoes'))
  assert.deepEqual(sessoes, ['2', '–', '–'])
  await abrir(view, 'main')
  assert.ok(tem(view, POOL, /orca-agent-pool-b6, gestaosmart/))
})

test('pool em inglês: resumo com sessões e sem RAM', async () => {
  view = await mount(panel, { host: hostCom(), locale: 'en' })
  assert.ok(view.find({ text: /Agents 1\/4 · Sessions 2 · Writer by quota pace/ }))
  assert.equal(view.find({ text: /Minimum RAM/ }), null)
  assert.deepEqual(cabecalho(view, ['conta', 'vagas', 'sessoes', 'h5', 'semanal']), ['ACCOUNT', 'SLOTS', 'SESSIONS', '5H', 'WEEKLY'])
})

test('pool: detalhes dentro da tabela, várias abertas, sem botão nem campo na linha', async () => {
  view = await mount(panel, { host: hostCom() })
  await abrir(view, 'main')
  await abrir(view, 'codex')
  assert.ok(linhasDe(POOL).includes('main#detalhes') && linhasDe(POOL).includes('codex#detalhes'))
  await abrir(view, 'main')
  assert.ok(!linhasDe(POOL).includes('main#detalhes') && linhasDe(POOL).includes('codex#detalhes'))
  await abrir(view, 'codex')
  assert.deepEqual(linhasDe(POOL), ['main', 'codex', 'claude-abcdef12'])
})

test('medida antiga: a conta manual com medida de mais de 30 min ganha aviso no detalhe; a cota nativa do Orca não', async () => {
  view = await mount(panel, { host: hostCom() })
  await abrir(view, 'main')
  assert.ok(tem(view, POOL, /Medida antiga: há 45 min/))
  await abrir(view, 'main')
  await abrir(view, 'codex')
  assert.equal(tem(view, POOL, /Medida antiga/), null)
})

test('Configurações: seção recolhida no fim, com abas Fila · Pool · Contas · Hooks · Instalação · Painel e a linha do que cada uma muda', async () => {
  view = await mount(panel, { host: hostCom() })
  assert.ok(view.find({ type: 'Collapsible', label: 'Configurações', text: /Fila, pool, contas, hooks, instalação e painel/ }))
  assert.equal(view.find({ label: 'Modo da fila: Global' }), null) // recolhida: nada de formulário à mostra
  await abrir(view)
  assert.ok(view.find({ type: 'Tabs', label: 'Assuntos das configurações' }))
  assert.ok(view.find({ text: /^Como os testes esperam a vez — ~\/\.agents\/agent-pool\/config\.json/ }))
  await view.select({ label: 'Assuntos das configurações' }, 'pool')
  assert.ok(view.find({ text: /^Limites da máquina e como o escritor é escolhido — ~\/\.agents\/agent-pool\/config\.json/ }))
  await view.select({ label: 'Assuntos das configurações' }, 'contas')
  assert.ok(
    view.find({
      text: /^Vagas, peso, papéis e ordem de cada conta — ~\/\.agents\/agent-pool\/config\.json\. As contas detectadas pelo Orca entram no pool sozinhas, marcadas como Não utilizar, até você ativá-las; as manuais são CLIs personalizados/,
    }),
  )
  await view.select({ label: 'Assuntos das configurações' }, 'imposicao')
  assert.ok(
    view.find({
      text: /^Os hooks fazem os agentes usar a fila de testes e reservar vaga antes do worker-start\. São obrigatórios: remover um trava o painel/,
    }),
  )
  await view.select({ label: 'Assuntos das configurações' }, 'painel')
  assert.ok(view.find({ text: /^Este painel — guardado no Orca/ }))
})

for (const [locale, configurar, cadastrar] of [
  ['en', 'Configure', 'Add'],
  ['pt-BR', 'Configurar', 'Cadastrar'],
]) {
  test(`${locale}: Contas tem as subabas ${configurar} e ${cadastrar}`, async () => {
    const t = textosPara(locale)
    view = await mount(panel, { locale, host: hostCom() })
    await view.toggle({ label: t.configuracoes.titulo })
    await view.select({ label: t.configuracoes.assuntos }, 'contas')
    assert.deepEqual([t.configuracoes.contasAbas.configurar, t.configuracoes.contasAbas.cadastrar], [configurar, cadastrar])
    assert.ok(view.find({ type: 'Tab', label: configurar }))
    assert.ok(view.find({ type: 'Tab', label: cadastrar }))
    assert.equal(view.valueOf({ label: t.pool.escolherConta }), 'main') // Configurar abre na conta escolhida
    assert.equal(view.find({ label: t.pool.novaNome }), null)
    await view.select({ label: t.configuracoes.contasAbas.assuntos }, 'cadastrar')
    assert.ok(view.find({ label: t.pool.novaNome }))
    assert.ok(view.find({ type: 'Button', text: t.pool.novaCriar }))
    assert.equal(view.find({ label: t.pool.escolherConta }), null)
  })
}

test('Configurações > Pool: escolher a conta na lista mostra o formulário dela e as dicas de cada campo e papel', async () => {
  view = await mount(panel, { host: hostCom() })
  await abrir(view, 'contas')
  assert.equal(view.valueOf({ label: 'Conta a configurar' }), 'main') // a primeira
  for (const trecho of [/^Quantos agentes desta conta/, /^Prioridade na escolha do escritor/, /^Pasta de configuração do agente/]) {
    assert.ok(view.find({ type: 'IconButton', label: trecho }), String(trecho))
  }
  for (const trecho of [
    /^Implementa a tarefa/,
    /^Gate de merge só leitura/,
    /^Contraprova só leitura/,
    /^Tarefas mecânicas/,
    /^Revisão adversarial/,
    /^Coordena os workers/,
  ]) {
    assert.ok(view.find({ type: 'IconButton', label: trecho }), String(trecho))
  }
  assert.ok(view.find({ type: 'Button', text: 'Remover do pool' }))
  await view.select({ label: 'Assuntos das configurações' }, 'pool')
  for (const trecho of [
    /^Máximo de agentes trabalhando/,
    /^Memória livre mínima/,
    /^Ritmo da cota: o escritor é a conta com mais cota sobrando/,
  ]) {
    assert.ok(view.find({ type: 'IconButton', label: trecho }), String(trecho))
  }
})

test('conta inativa: marcada na tabela, explicada no detalhe e com "Não utilizar" marcado; não existe mais Adicionar ao pool', async () => {
  view = await mount(panel, { host: hostCom() })
  assert.ok(tem(view, POOL, /claude-abcdef12 \(não utilizada\)/))
  assert.equal(tem(view, POOL, /main \(não utilizada\)/), null)
  await abrir(view, 'claude-abcdef12')
  assert.ok(tem(view, POOL, /Não utilizada: continua listada e medida/))
  await abrir(view, 'contas')
  assert.equal(view.find({ type: 'Checkbox', label: 'Não utilizar' })?.props.checked, false) // a primeira (main) está ativa
  await view.select({ label: 'Conta a configurar' }, 'claude-abcdef12')
  assert.equal(view.find({ type: 'Checkbox', label: 'Não utilizar' })?.props.checked, true)
  assert.equal(view.find({ type: 'Button', text: 'Adicionar ao pool' }), null)
})

test('"Não utilizar" grava conta.<nome>.ativo=nao e, desmarcada, =sim; a dica explica o efeito', async () => {
  const enviados: unknown[] = []
  view = await mount(panel, { host: hostCom(enviados) })
  await abrir(view, 'contas')
  assert.ok(view.find({ type: 'IconButton', label: /^A conta continua listada e medida, mas não recebe trabalho nem conta no teto/ }))
  await view.toggle({ label: 'Não utilizar' })
  await view.press({ type: 'Button', text: 'Salvar' })
  await view.select({ label: 'Conta a configurar' }, 'claude-abcdef12')
  await view.toggle({ label: 'Não utilizar' })
  await view.press({ type: 'Button', text: 'Salvar' })
  assert.deepEqual(enviados, [{ 'conta.main.ativo': 'nao' }, { 'conta.claude-abcdef12.ativo': 'sim' }])
})

test('editar a conta escolhida manda só o que mudou e mostra o estado novo', async () => {
  const enviados: unknown[] = []
  let atual: Estado = estadoExemplo
  const host = mockHost({
    requests: {
      'estado.ler': () => atual,
      'config.gravar': ({ valores }) => {
        enviados.push(valores)
        atual = { ...atual, pool: { ...atual.pool, contas: atual.pool.contas.map(c => (c.nome === 'main' ? { ...c, vagas: 3 } : c)) } }
        return atual
      },
    },
  })
  view = await mount(panel, { host })
  await abrir(view, 'contas')
  await view.type({ label: 'Vagas da conta' }, '3', { replace: true })
  await view.press({ type: 'Button', text: 'Salvar' }) // aba Contas: só o Salvar da conta aberta
  assert.deepEqual(enviados, [{ 'conta.main.vagas': '3' }])
  assert.deepEqual(view.refusals, [])
})

test('setas ↑/↓ da conta escolhida: gravam pool.ordem com a lista completa; a primeira não sobe e a última não desce', async () => {
  const enviados: unknown[] = []
  view = await mount(panel, { host: hostCom(enviados) })
  await abrir(view, 'contas')
  assert.equal(view.find({ type: 'IconButton', label: 'Subir' })?.disabled, true) // main é a primeira
  assert.equal(view.find({ type: 'IconButton', label: 'Descer' })?.disabled, false)
  await view.select({ label: 'Conta a configurar' }, 'claude-abcdef12')
  assert.equal(view.find({ type: 'IconButton', label: 'Descer' })?.disabled, true) // a inativa também entra na ordem, e é a última
  await view.select({ label: 'Conta a configurar' }, 'codex')
  await view.press({ type: 'IconButton', label: 'Subir' })
  assert.deepEqual(enviados, [{ 'pool.ordem': 'codex,main,claude-abcdef12' }])
})

test('Remover do pool pede confirmação e só então grava conta.<nome>.remover=1', async () => {
  const enviados: unknown[] = []
  view = await mount(panel, { host: hostCom(enviados, codexManual) })
  await abrir(view, 'contas')
  await view.select({ label: 'Conta a configurar' }, 'codex')
  await view.press({ type: 'Button', text: 'Remover do pool' })
  assert.deepEqual(enviados, [])
  assert.ok(view.find({ text: /Remover codex da configuração\?/ }))
  await view.press({ type: 'Button', text: 'Cancelar' })
  assert.deepEqual(enviados, [])
  await view.press({ type: 'Button', text: 'Remover do pool' })
  await view.press({ type: 'Button', text: 'Confirmar remoção' })
  assert.deepEqual(enviados, [{ 'conta.codex.remover': '1' }])
})

test('Nova conta manual: nome, comando do CLI e diretório de config (um dos dois basta) viram adicionar=auto, com dicas e sem agente do catálogo', async () => {
  const enviados: unknown[] = []
  view = await mount(panel, { host: hostCom(enviados) })
  await abrir(view, 'contas')
  await view.select({ label: 'Assuntos das contas' }, 'cadastrar')
  for (const trecho of [/^Comando que abre o CLI desta conta/, /^Pasta de configuração do CLI/]) {
    assert.ok(view.find({ type: 'IconButton', label: trecho }), String(trecho))
  }
  assert.equal(view.find({ label: 'Agente do catálogo' }), null)
  assert.equal(view.find({ type: 'Button', text: 'Adicionar conta' })?.disabled, true)
  await view.type({ label: 'Nome' }, 'minha')
  assert.equal(view.find({ type: 'Button', text: 'Adicionar conta' })?.disabled, true) // falta comando ou config
  await view.type({ label: 'Diretório de config' }, '~/.claude-extra')
  await view.type({ label: 'Comando do CLI' }, 'claude-extra')
  await view.press({ type: 'Button', text: 'Adicionar conta' })
  assert.deepEqual(enviados, [
    { 'conta.minha.adicionar': 'auto', 'conta.minha.config': '~/.claude-extra', 'conta.minha.comando': 'claude-extra' },
  ])
  assert.equal(view.valueOf({ label: 'Nome' }), '')
})

test('Nova conta manual: só o comando também vale, e a recusa do backend aparece em português', async () => {
  const host = mockHost({
    requests: {
      'estado.ler': () => estadoExemplo,
      'config.gravar': () => {
        throw hostError('config_recusada', 'Não consegui deduzir o agente de "xpto".')
      },
    },
  })
  view = await mount(panel, { host })
  await abrir(view, 'contas')
  await view.select({ label: 'Assuntos das contas' }, 'cadastrar')
  await view.type({ label: 'Nome' }, 'minha')
  await view.type({ label: 'Comando do CLI' }, 'xpto')
  await view.press({ type: 'Button', text: 'Adicionar conta' })
  assert.ok(view.find({ text: 'Não consegui deduzir o agente de "xpto".' }))
  assert.equal(view.valueOf({ label: 'Nome' }), 'minha')
})

test('modo da fila: cada opção é um rádio com o ícone de dica ao lado, sem linhas repetidas', async () => {
  const enviados: unknown[] = []
  view = await mount(panel, { host: hostCom(enviados) })
  await abrir(view)
  const grupos = view.findAll({ role: 'radiogroup' })
  assert.deepEqual(
    grupos.map(g => g.label),
    ['Modo da fila: Global', 'Modo da fila: Por banco', 'Modo da fila: Por projeto'],
  )
  assert.equal(
    view.findAll({ type: 'IconButton', label: /^Uma fila única para a máquina|^Uma fila por banco|^Cada projeto tem a própria fila/ })
      .length,
    3,
  )
  assert.ok(view.find({ type: 'IconButton', label: /^Máximo de testes ao mesmo tempo na máquina/ }))
  assert.equal(view.find({ type: 'IconButton', label: /Só vale no modo Por projeto/ }), null) // o campo de projeto só aparece no modo projeto
  await view.select({ label: 'Modo da fila: Por projeto' }, 'projeto')
  await view.press(view.findAll({ type: 'Button', text: 'Salvar' })[0])
  assert.deepEqual(enviados, [{ 'fila.modo': 'projeto' }])
})

test('limpar bancos ligado: caixa marcada e desmarcar grava nao', async () => {
  const enviados: unknown[] = []
  const ligado: Estado = {
    ...estadoExemplo,
    fila: { ...estadoExemplo.fila, config: { ...estadoExemplo.fila.config, limpar_bancos: 'sim' } },
  }
  view = await mount(panel, { host: hostCom(enviados, ligado) })
  await abrir(view)
  assert.equal(view.find({ type: 'Checkbox', label: /^Apagar os bancos/ })?.props.checked, true)
  await view.toggle({ label: /^Apagar os bancos/ })
  await view.press(view.findAll({ type: 'Button', text: 'Salvar' })[0])
  assert.deepEqual(enviados, [{ 'fila.limpar_bancos': 'nao' }])
})

test('limpar bancos desligado: caixa desmarcada e marcar grava sim', async () => {
  const enviados: unknown[] = []
  view = await mount(panel, { host: hostCom(enviados) })
  await abrir(view)
  assert.equal(view.find({ type: 'Checkbox', label: /^Apagar os bancos/ })?.props.checked, false)
  await view.toggle({ label: /^Apagar os bancos/ })
  await view.press(view.findAll({ type: 'Button', text: 'Salvar' })[0])
  assert.deepEqual(enviados, [{ 'fila.limpar_bancos': 'sim' }])
})

test('Vagas diz a verdade em cada modo: no modo banco cada banco tem 1 vaga e o campo vale para as filas sem banco', async () => {
  view = await mount(panel, { host: hostCom() })
  await abrir(view)
  assert.ok(view.find({ type: 'IconButton', label: /^Testes ao mesmo tempo em cada fila\. No modo Por banco, cada banco tem 1 vaga/ }))
  await view.unmount()
  view = await mount(panel, { locale: 'en', host: hostCom() })
  await view.toggle({ label: 'Settings' })
  assert.ok(view.find({ type: 'IconButton', label: /^Concurrent tests in each queue\. In Per database mode each database gets 1 slot/ }))
})

test('a fila mostra o valor configurado', async () => {
  view = await mount(panel, { host: hostCom() })
  await abrir(view)
  assert.equal(view.valueOf({ label: 'Vagas' }), '5')
})

test('recusa do validador aparece em português e não limpa a edição', async () => {
  const host = mockHost({
    requests: {
      'estado.ler': () => estadoExemplo,
      'config.gravar': () => {
        throw hostError('config_recusada', 'fila.vagas: valor_invalido')
      },
    },
  })
  view = await mount(panel, { host })
  await abrir(view)
  await view.type({ label: 'Vagas' }, '0', { replace: true })
  await view.press(view.findAll({ type: 'Button', text: 'Salvar' })[0])
  assert.ok(view.find({ text: 'fila.vagas: valor inválido' }))
  assert.equal(view.valueOf({ label: 'Vagas' }), '0')
})

test('erro do coletor aparece com o código e some na próxima leitura boa', async () => {
  let falha = true
  const host = mockHost({
    requests: {
      'estado.ler': () => {
        if (falha) throw hostError('coletor_falhou', 'worker saiu com 1')
        return estadoExemplo
      },
    },
  })
  view = await mount(panel, { host })
  assert.ok(view.find({ text: /coletor_falhou/ }))
  assert.ok(view.find({ text: /worker saiu com 1/ }))
  falha = false
  await view.press({ text: 'Atualizar' })
  assert.equal(view.find({ text: /coletor_falhou/ }), null)
  assert.deepEqual(linhasDe(POOL), ['main', 'codex', 'claude-abcdef12'])
})

test('o post estado.mudou lê o estado de novo', async () => {
  let n = 0
  const host = mockHost({
    requests: { 'estado.ler': () => ({ ...estadoExemplo, pool: { ...estadoExemplo.pool, contas: n++ ? [] : estadoExemplo.pool.contas } }) },
  })
  view = await mount(panel, { host })
  assert.equal(n, 1)
  await view.post('estado.mudou', { em: 1 })
  assert.equal(n, 2)
  assert.ok(view.find({ text: 'Nenhuma conta no registro.' }))
})

test('Configurações > Painel: intervalo de atualização (15 a 3600 s) grava no storage do painel', async () => {
  const host = mockHost({
    capabilities: ['storage:own'],
    storage: { 'atualizacao.intervalo_s': 90 },
    requests: { 'estado.ler': () => estadoExemplo },
  })
  view = await mount(panel, { host })
  await abrir(view, 'painel')
  assert.equal(view.valueOf({ label: 'Atualizar a cada (segundos)' }), '90')
  assert.ok(view.find({ type: 'IconButton', label: /^Coleta local feita pelo worker, sem IA e sem gastar tokens/ }))
  for (const ruim of ['5', '3601', 'abc', '']) {
    await view.type({ label: 'Atualizar a cada (segundos)' }, ruim, { replace: true })
    await view.press(view.findAll({ type: 'Button', text: 'Salvar' }).at(-1)!)
    assert.ok(view.find({ text: 'Informe um número inteiro de 15 a 3600.' }), ruim)
  }
  assert.equal(host.data().storage['atualizacao.intervalo_s'], 90)
  await view.type({ label: 'Atualizar a cada (segundos)' }, '120', { replace: true })
  await view.press(view.findAll({ type: 'Button', text: 'Salvar' }).at(-1)!)
  assert.equal(host.data().storage['atualizacao.intervalo_s'], 120)
  assert.ok(view.find({ text: 'Salvo.' }))
  assert.deepEqual(view.refusals, [])
})

const faltando: Requisitos = {
  ok: false,
  itens: [
    { id: 'orca', ok: true, detalhe: { codigo: 'versao', valor: '1.4.247' } },
    { id: 'orchestration', ok: false, detalhe: { codigo: 'nao_instalada' }, instalar: true },
    { id: 'lancador', ok: false, detalhe: { codigo: 'nao_instalado' } },
  ],
}

test('requisitos faltando: só a seção Requisitos, com ✓/✗, o detalhe no idioma e botão Instalar só onde há ação', async () => {
  let estadoLido = 0
  const host = mockHost({
    requests: {
      'requisitos.ler': () => faltando,
      'estado.ler': () => {
        estadoLido++
        return estadoExemplo
      },
    },
  })
  view = await mount(panel, { host })
  assert.deepEqual(idsReq(view), ['orca', 'orchestration', 'lancador'])
  assert.ok(view.find({ type: 'Collapsible', label: '✓ Orca', text: /Obrigatório · instalado/ }))
  assert.equal(view.find(FILA), null)
  assert.equal(view.find(POOL), null)
  assert.equal(view.find({ type: 'Heading', text: 'Configurações' }), null)
  assert.equal(estadoLido, 0) // nem coleta o resto
  await abrirReq(view, 'orchestration')
  await abrirReq(view, 'lancador')
  assert.ok(view.find({ text: /não instalada/ }))
  assert.ok(view.find({ text: /não instalado/ }))
  assert.equal(view.findAll({ type: 'Button', text: 'Instalar' }).length, 1) // só quem traz `instalar`
})

const tudoOk: Requisitos = {
  ok: true,
  itens: [
    { id: 'orca', ok: true, detalhe: { codigo: 'versao', valor: '1.4.247' } },
    { id: 'orchestration', ok: true, detalhe: { codigo: 'instalada' } },
    { id: 'skill', ok: true, detalhe: { codigo: 'instalada' } },
    { id: 'lancador', ok: true, detalhe: { codigo: 'instalado', valor: '~/.agents/bin/agent-pool' } },
    {
      id: 'hooks',
      ok: true,
      detalhe: {
        codigo: 'hooks',
        agentes: [
          { agente: 'claude', situacao: 'instalado' },
          { agente: 'codex', situacao: 'instalado' },
        ],
      },
    },
  ],
}

for (const [locale, versao, instalada, lancador] of [
  ['pt-BR', /versão 1\.4\.247/, /: instalada/, /~\/\.agents\/bin\/agent-pool/],
  ['en', /version 1\.4\.247/, /: installed/, /~\/\.agents\/bin\/agent-pool/],
] as const) {
  test(`${locale}: aba Instalação lista os 5 requisitos com ✓, o caminho do lançador, os agentes dos hooks, verificar e desinstalar`, async () => {
    const t = textosPara(locale)
    view = await mount(panel, {
      locale,
      host: mockHost({ requests: { 'requisitos.ler': () => tudoOk, 'estado.ler': () => estadoExemplo } }),
    })
    await view.toggle({ label: t.configuracoes.titulo })
    await view.select({ label: t.configuracoes.assuntos }, 'instalacao')
    assert.ok(view.find({ type: 'Tab', label: locale === 'en' ? 'Installation' : 'Instalação' }))
    const ids = idsReq(view, locale)
    assert.deepEqual(ids, ['orca', 'orchestration', 'skill', 'lancador', 'hooks'])
    for (const id of ['orca', 'orchestration', 'skill', 'lancador', 'hooks'] as const) await abrirReq(view, id, true, locale)
    for (const texto of [versao, instalada, lancador, /claude: (instalado|installed); codex/])
      assert.ok(view.find({ text: texto }), String(texto))
    assert.ok(view.find({ text: t.requisitos.oQueFaz.hooks }))
    assert.equal(view.find({ type: 'Button', text: t.requisitos.instalar }), null)
    assert.ok(view.find({ type: 'Button', text: t.requisitos.verificar }))
    assert.ok(view.find({ type: 'Button', text: t.desinstalar.botao }))
  })
}

test('Instalação: Verificar agora chama requisitos.ler com forcar; leitura forçada com pendência leva à tela de pendências', async () => {
  const entradas: unknown[] = []
  let leiturasHooks = 0
  const t = textosPara('pt-BR')
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'requisitos.ler': entrada => {
          entradas.push(entrada)
          return entradas.length === 1 ? tudoOk : faltando
        },
        'hooks.estado': () => {
          leiturasHooks++
          return [{ agente: 'claude', estado: 'instalado' as const }]
        },
        'estado.ler': () => estadoExemplo,
      },
    }),
  })
  await abrir(view, 'instalacao')
  const antes = leiturasHooks
  await view.press({ type: 'Button', text: t.requisitos.verificar })
  assert.deepEqual(entradas.at(1), { forcar: true })
  assert.ok(leiturasHooks > antes, 'Verificar agora relê os hooks')
  assert.deepEqual(idsReq(view), ['orca', 'orchestration', 'lancador'])
  assert.equal(view.find({ type: 'Heading', text: 'Configurações' }), null)
})

test('Instalação: leitura forçada que volta vazia avisa em vez de manter a tabela como conferida', async () => {
  let lidas = 0
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'requisitos.ler': () => (lidas++ === 0 ? tudoOk : (null as never)),
        'estado.ler': () => estadoExemplo,
      },
    }),
  })
  await abrir(view, 'instalacao')
  await view.press({ type: 'Button', text: 'Verificar agora' })
  assert.ok(view.find({ text: /Não consegui reler os requisitos/ }))
})

test('Instalação: requisitos ainda não lidos mostram o aviso e o botão', async () => {
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'requisitos.ler': () => {
          throw hostError('unknown_method', 'sem handler')
        },
        'estado.ler': () => estadoExemplo,
      },
    }),
  })
  await abrir(view, 'instalacao')
  assert.ok(view.find({ text: 'Requisitos não verificados.' }))
  assert.ok(view.find({ type: 'Button', text: 'Verificar agora' }))
})

test('Instalar chama requisitos.instalar com o id e lê os requisitos de novo; com tudo ok volta o painel normal', async () => {
  const instalados: unknown[] = []
  let r: Requisitos = faltando
  const host = mockHost({
    requests: {
      'requisitos.ler': () => r,
      'requisitos.instalar': ({ id }) => {
        instalados.push(id)
        r = { ok: true, itens: faltando.itens.map(i => ({ ...i, ok: true })) }
        return r
      },
      'estado.ler': () => estadoExemplo,
    },
  })
  view = await mount(panel, { host })
  await abrirReq(view, 'orchestration')
  await view.press({ type: 'Button', text: 'Instalar' })
  assert.deepEqual(instalados, ['orchestration'])
  assert.deepEqual(linhasDe(POOL), ['main', 'codex', 'claude-abcdef12'])
  assert.deepEqual(idsReq(view), [])
})

const tres: Requisitos = {
  ok: false,
  itens: [
    { id: 'orchestration', ok: false, detalhe: { codigo: 'nao_instalada' }, instalar: true },
    { id: 'skill', ok: false, detalhe: { codigo: 'nao_instalada' }, instalar: true },
    { id: 'hooks', ok: false, detalhe: { codigo: 'hooks_nenhum' }, instalar: true },
  ],
}

for (const releitura of ['null', 'unknown_method'] as const) {
  test(`instalação que falha mantém a lista de pendências e o erro; releitura ${releitura} também mantém`, async () => {
    let lidas = 0
    const host = mockHost({
      requests: {
        'requisitos.ler': () => {
          if (lidas++ === 0) return tres
          if (releitura === 'null') return null as never
          throw hostError('unknown_method', 'sem handler')
        },
        'requisitos.instalar': () => {
          throw hostError('instalacao_falhou', 'falhou aqui')
        },
        'estado.ler': () => estadoExemplo,
      },
    })
    view = await mount(panel, { host })
    await abrirReq(view, 'orchestration')
    await view.press(view.findAll({ type: 'Button', text: 'Instalar' })[0]!)
    assert.deepEqual(idsReq(view), ['orchestration', 'skill', 'hooks'])
    assert.ok(view.find({ text: /falhou aqui/ }))
    assert.equal(view.find(POOL), null)
  })
}

test('aviso de releitura que falhou some quando chega uma leitura válida, ainda pendente', async () => {
  let lidas = 0
  const host = mockHost({
    requests: { 'requisitos.ler': () => (lidas++ === 1 ? (null as never) : tres), 'estado.ler': () => estadoExemplo },
  })
  view = await mount(panel, { host })
  await view.press(view.find({ type: 'Button', text: 'Atualizar' })!)
  assert.ok(view.find({ text: /Não consegui reler os requisitos/ }))
  await view.press(view.find({ type: 'Button', text: 'Atualizar' })!)
  assert.equal(view.find({ text: /Não consegui reler os requisitos/ }), null)
  assert.deepEqual(idsReq(view), ['orchestration', 'skill', 'hooks'])
})

for (const resposta of [{}, null, { ok: true }, { itens: [] }]) {
  test(`requisitos.instalar com resposta fora do formato (${JSON.stringify(resposta)}) mantém a lista`, async () => {
    let lidas = 0
    const host = mockHost({
      requests: {
        'requisitos.ler': () => (lidas++ === 0 ? tres : (null as never)),
        'requisitos.instalar': () => resposta as never,
        'estado.ler': () => estadoExemplo,
      },
    })
    view = await mount(panel, { host })
    await abrirReq(view, 'orchestration')
    await view.press(view.findAll({ type: 'Button', text: 'Instalar' })[0]!)
    assert.deepEqual(idsReq(view), ['orchestration', 'skill', 'hooks'])
    assert.equal(view.find(POOL), null)
  })
}

for (const [locale, aviso] of [
  ['pt-BR', 'Requisitos instalados. O painel já está pronto.'],
  ['en', 'Requirements installed. The panel is ready.'],
] as const) {
  test(`${locale}: instalação que deixa tudo ok mostra o aviso verde na visão normal e ele some na próxima atualização`, async () => {
    let r: Requisitos = tres
    const host = mockHost({
      requests: {
        'requisitos.ler': () => r,
        'requisitos.instalar': () => (r = { ok: true, itens: tres.itens.map(i => ({ ...i, ok: true })) }),
        'estado.ler': () => estadoExemplo,
      },
    })
    view = await mount(panel, { host, locale })
    await abrirReq(view, 'orchestration', false, locale)
    await view.press(view.findAll({ type: 'Button' }).find(b => /Instal|Install/.test(String(b.text)))!)
    assert.ok(view.find({ type: 'Text', text: aviso }))
    assert.deepEqual(idsReq(view, locale), [])
    await view.press(view.findAll({ type: 'Button' }).find(b => /Atualizar|Refresh/.test(String(b.text)))!)
    assert.equal(view.find({ text: aviso }), null)
  })
}

test('primeira leitura unknown_method (worker antigo, sem pendência vista): visão normal, sem aviso', async () => {
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'requisitos.ler': () => {
          throw hostError('unknown_method', 'sem handler')
        },
        'estado.ler': () => estadoExemplo,
      },
    }),
  })
  assert.deepEqual(linhasDe(POOL), ['main', 'codex', 'claude-abcdef12'])
  assert.equal(view.find({ text: /Requisitos instalados/ }), null)
})

test('requisitos ok: o painel normal; worker sem o handler (unknown_method): também o painel normal', async () => {
  view = await mount(panel, {
    host: mockHost({ requests: { 'requisitos.ler': () => ({ ok: true, itens: [] }), 'estado.ler': () => estadoExemplo } }),
  })
  assert.deepEqual(linhasDe(POOL), ['main', 'codex', 'claude-abcdef12'])
  assert.deepEqual(idsReq(view), [])
})

test('alertas: sem alertas o bloco Atenção não aparece', async () => {
  view = await mount(panel, { host: hostCom() })
  assert.equal(view.find({ text: /Atenção/ }), null)
})

test('alertas: o bloco Atenção lista um item por problema e o comando num Code; a conta com problema mostra ⚠ — e repete problema e ação', async () => {
  view = await mount(panel, { host: hostCom([], estadoComAlertas) })
  assert.ok(view.find({ type: 'Callout', text: /Atenção/ }))
  for (const trecho of [/work: sem login/, /codex: token expirado/, /Orca indisponível/, /Teste parado \(pid 99\) em wt-dois/]) {
    assert.ok(view.find({ type: 'Callout', text: trecho }), String(trecho))
  }
  assert.ok(view.find({ type: 'Code', text: /claude auth login/ }))
  assert.equal(view.findAll({ type: 'Code' }).length, 1)
  assert.ok(tem(view, POOL, /⚠ —/))
  assert.equal(tem(view, POOL, /84%/), null) // o valor velho da conta sem login não aparece
  await abrir(view, 'work')
  assert.ok(tem(view, POOL, /Problema.*sem login/))
  assert.ok(tem(view, POOL, /Para resolver.*claude auth login/))
  assert.deepEqual(view.errors, [])
})

test('fila: comando longo (1500 caracteres) aparece inteiro no detalhe, sem recusa do Orca', async () => {
  const longo = 'x'.repeat(1500)
  const estado: Estado = {
    ...estadoExemplo,
    fila: { ...estadoExemplo.fila, testes: [{ ...estadoExemplo.fila.testes[0], comando: longo }] },
  }
  view = await mount(panel, { host: hostCom([], estado) })
  await abrir(view, 'p4242')
  assert.equal(valorDe(view, 'p4242', 5), longo)
  assert.deepEqual([view.errors, view.warnings, view.refusals], [[], [], []])
})

test('modo da fila: o valor dos rádios é sempre controlado, só o do modo atual vem marcado', async () => {
  view = await mount(panel, { host: hostCom() })
  await abrir(view)
  const valores = () => view!.findAll({ role: 'radiogroup' }).map(g => g.props.value)
  assert.deepEqual(valores(), ['global', '', ''])
  await view.select({ label: 'Modo da fila: Por projeto' }, 'projeto')
  assert.deepEqual(valores(), ['', '', 'projeto'])
  await view.select({ label: 'Modo da fila: Por banco' }, 'banco')
  assert.deepEqual(valores(), ['', 'banco', ''])
  assert.deepEqual(view.refusals, [])
})

for (const [locale, projeto, teto] of [
  ['pt-BR', 'Projeto gestaosmart', 'Teto da máquina'],
  ['en', 'Project gestaosmart', 'Machine cap'],
] as const) {
  test(`${locale}: coluna Fila vem da fila real de cada linha, não do modo atual`, async () => {
    const base = estadoExemplo.fila.testes[0]
    const linha = (pid: number, fila: string | null, recurso: string) => ({ ...base, pid, fila, recurso, projeto: 'gestaosmart' })
    const estado: Estado = {
      ...estadoExemplo,
      fila: {
        ...estadoExemplo.fila,
        modo: 'projeto',
        testes: [
          linha(1, 'proj-gestaosmart', 'mysql 127.0.0.1:3307/gestaosmart_wt_1_test'),
          linha(2, 'mysql_127_0_0_1_3307_gestaosmart_wt_1_test', 'mysql 127.0.0.1:3307/gestaosmart_wt_1_test'),
          linha(3, '_teto', 'mysql 127.0.0.1:3307/gestaosmart_wt_1_test'),
          linha(4, null, 'mysql 127.0.0.1:3307/gestaosmart_wt_1_test'),
          linha(5, 'global', 'geral'),
        ],
      },
    }
    view = await mount(panel, { locale, host: hostCom([], estado) })
    const cel = (pid: number) => celula(view!, `p${pid}`, 'fila')
    assert.deepEqual([1, 2, 3, 4, 5].map(cel), [
      projeto,
      locale === 'en' ? 'Database 127.0.0.1:3307/gestaosmart_wt_1_test' : 'Banco 127.0.0.1:3307/gestaosmart_wt_1_test',
      teto,
      projeto,
      'Global',
    ])
  })
}

const comModelo = (modelo: string | null, limite: string | null): Estado => ({
  ...estadoExemplo,
  pool: {
    ...estadoExemplo.pool,
    contas: estadoExemplo.pool.contas.map(c => (c.nome === 'main' ? { ...c, modelo, modelo_efetivo: modelo, limite_seguido: limite } : c)),
  },
})

for (const [locale, rotulo, geral, pool] of [
  ['pt-BR', 'Modelo', 'Geral', 'Contas do pool'],
  ['en', 'Model', 'General', 'Pool accounts'],
]) {
  test(`${locale}: detalhe da conta mostra o modelo e o limite seguido (ou o geral); sem modelo, sem a linha`, async () => {
    view = await mount(panel, { locale, host: hostCom([], comModelo('claude-fable-5-1', 'Fable')) })
    await abrir(view, 'main')
    assert.ok(tem(view, lista(pool), new RegExp(`${rotulo}.*claude-fable-5-1 · Fable`)))
    view.unmount()
    view = await mount(panel, { locale, host: hostCom([], comModelo('qwen', null)) })
    await abrir(view, 'main')
    assert.ok(tem(view, lista(pool), new RegExp(`qwen · ${geral}`)))
    view.unmount()
    view = await mount(panel, { locale, host: hostCom() })
    await abrir(view, 'main')
    assert.equal(tem(view, lista(pool), new RegExp(`${rotulo}.*·`)), null)
  })
}

test('Configurações > Contas: campo Modelo grava conta.<nome>.modelo e explica o limite seguido', async () => {
  const gravados: unknown[] = []
  view = await mount(panel, { host: hostCom(gravados) })
  await abrir(view, 'contas')
  await view.type({ label: 'Modelo' }, 'claude-fable-5-1', { replace: true })
  await view.press({ type: 'Button', text: 'Salvar' })
  assert.deepEqual(gravados, [{ 'conta.main.modelo': 'claude-fable-5-1' }])
  assert.ok(view.find({ type: 'IconButton', label: /Gemini 4 Argon.*Gemini Models.*Claude and GPT models.*gemini-3\.8-flash-high/s }))
})

test('Configurações > Contas em inglês: campo Model e dica em inglês', async () => {
  view = await mount(panel, { locale: 'en', host: hostCom() })
  await view.toggle({ label: 'Settings' })
  await view.select({ label: 'Settings sections' }, 'contas')
  assert.ok(view.find({ type: 'Input', label: 'Model' }))
  assert.ok(view.find({ type: 'IconButton', label: /Fable.*Gemini 4 Argon.*default/s }))
})
