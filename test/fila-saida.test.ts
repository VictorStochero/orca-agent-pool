import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acompanharSaida } from '../src/core/fila/saida.ts'

const alimentar = (...partes: (string | Buffer)[]) => {
  const a = acompanharSaida(() => 1000)
  for (const p of partes) a.receber('out', Buffer.from(p))
  return a.estado()
}

test('sem saída não há estado', () => {
  assert.equal(acompanharSaida(() => 1).estado(), null)
})

test('PHPUnit/paratest: feitos, total e pct do fim da linha', () => {
  const s = alimentar(
    '..........                                                        10 / 120 (  8%)\n',
    '...                 63 / 120 ( 52%)\n',
  )
  assert.deepEqual(s, {
    ts: 1000,
    linha: '...                 63 / 120 ( 52%)',
    linhas: 2,
    pct: 52,
    feitos: 63,
    total: 120,
    passou: 13,
    falhou: 0,
  })
})

test('pytest: só o pct', () => {
  const s = alimentar('tests/test_a.py ....                                   [ 45%]\n')
  assert.equal(s?.pct, 45)
  assert.equal(s?.feitos, null)
  assert.equal(s?.total, null)
})

test('Pest/Collision e vitest: cada marca no começo da linha soma 1 em feitos', () => {
  const s = alimentar('  ✓ it works\n  ⨯ it fails\n  × outro\n  ✔ ok\n  ✗ ruim\n  ✕ ruim2\n  texto ✓ no meio\n')
  assert.equal(s?.feitos, 6)
  assert.equal(s?.total, null)
  assert.equal(s?.pct, null)
  assert.equal(s?.linhas, 7)
})

test('marcas deixam de contar depois que um total foi visto', () => {
  const s = alimentar('  5 / 10 ( 50%)\n  ✓ it works\n')
  assert.deepEqual([s?.feitos, s?.total, s?.pct], [5, 10, 50])
})

test('remove ANSI da última linha e apara', () => {
  assert.equal(alimentar('\u001b[32m  ✓ it works\u001b[0m  \n')?.linha, '✓ it works')
})

test('chunk que parte um ✓ ao meio não corrompe', () => {
  const b = Buffer.from('  ✓ it works\n')
  const corte = b.indexOf(0xe2) + 1
  const s = alimentar(b.subarray(0, corte), b.subarray(corte))
  assert.deepEqual([s?.feitos, s?.linhas, s?.linha], [1, 1, '✓ it works'])
})

test('\\r sozinho quebra linha e a linha incompleta espera o próximo chunk', () => {
  const s = alimentar('a\rb\rparc', 'ial\n')
  assert.deepEqual([s?.linhas, s?.linha], [3, 'parcial'])
})

test('\\r\\n conta uma linha só', () => {
  assert.equal(alimentar('a\r\nb\r\n')?.linhas, 2)
})

test('corta a linha em 200 caracteres', () => {
  assert.equal(alimentar(`${'x'.repeat(500)}\n`)?.linha?.length, 200)
})

test('ts acompanha qualquer chunk, inclusive stderr e sem linha completa', () => {
  let t = 10
  const a = acompanharSaida(() => t)
  a.receber('out', Buffer.from('a\n'))
  t = 20
  a.receber('err', Buffer.from('sem quebra'))
  const s = a.estado()
  assert.deepEqual([s?.ts, s?.linhas, s?.linha], [20, 1, 'a'])
})

test('compacto do PHPUnit/Pest: os símbolos de progresso de uma linha somam em feitos', () => {
  const s = alimentar('....⨯..S.\n')
  assert.deepEqual([s?.feitos, s?.total, s?.pct, s?.linhas], [9, null, null, 1])
})

test('compacto em pedaços e sem quebra: conta a linha ainda não terminada, sem contar duas vezes', () => {
  const a = acompanharSaida(() => 1)
  a.receber('out', Buffer.from('...'))
  assert.equal(a.estado()?.feitos, 3)
  a.receber('out', Buffer.from('..⨯.'))
  assert.equal(a.estado()?.feitos, 7)
  a.receber('out', Buffer.from('\n'))
  assert.deepEqual([a.estado()?.feitos, a.estado()?.linhas], [7, 1])
  a.receber('out', Buffer.from('..\n'))
  assert.equal(a.estado()?.feitos, 9)
})

test('compacto misturado com o PHPUnit padrão: o total vence', () => {
  const s = alimentar('....\n', '.....  63 / 120 ( 52%)\n', '..\n')
  assert.deepEqual([s?.feitos, s?.total, s?.pct], [63, 120, 52])
})

test('linha comum com ponto final não conta como símbolo', () => {
  assert.equal(alimentar('Done.\n', 'Tests: 3, Assertions: 3.\n')?.feitos, null)
})

test('pendente que não é só símbolos não conta', () => {
  assert.equal(alimentar('Running tests...')?.feitos, null)
})

const contagem = (...partes: string[]) => {
  const s = alimentar(...partes)
  return [s?.passou, s?.falhou, s?.feitos, s?.total]
}

test('marcas mistas: ✓ e ✔ passaram, ⨯ × ✕ ✗ falharam', () => {
  assert.deepEqual(contagem('  ✓ a\n  ✔ b\n  ⨯ c\n  × d\n  ✕ e\n  ✗ f\n'), [2, 4, 6, null])
})

test('compacto ..F..E.s em pedaços: passou 5, falhou 2, s não conta em nenhum', () => {
  const a = acompanharSaida(() => 1)
  a.receber('out', Buffer.from('..F'))
  assert.deepEqual([a.estado()?.passou, a.estado()?.falhou], [2, 1])
  a.receber('out', Buffer.from('..E.s'))
  assert.deepEqual([a.estado()?.passou, a.estado()?.falhou, a.estado()?.feitos], [5, 2, 8])
  a.receber('out', Buffer.from('\n'))
  assert.deepEqual([a.estado()?.passou, a.estado()?.falhou, a.estado()?.feitos], [5, 2, 8])
})

test('PHPUnit padrão ..F.  4 / 10 ( 40%): passou 3, falhou 1, total 10', () => {
  assert.deepEqual(contagem('..F.  4 / 10 ( 40%)\n'), [3, 1, 4, 10])
})

test('sem símbolos nem marcas (pytest ou nada) passou e falhou ficam null', () => {
  assert.deepEqual(contagem('tests/test_a.py ....   [ 45%]\n'), [null, null, null, null])
})

test('só pulados: contou algo, então passou 0 e falhou 0', () => {
  assert.deepEqual(contagem('ss\n'), [0, 0, 2, null])
})

test('total da listagem: % = feitos ÷ total, travada em 99; sem saída ainda dá 0% (0/N) com ts 0', () => {
  const a = acompanharSaida(() => 5)
  a.definirTotal(4)
  assert.deepEqual(a.estado(), { ts: 0, linha: null, linhas: 0, pct: 0, feitos: 0, total: 4, passou: null, falhou: null })
  a.receber('out', Buffer.from('  ✓ a\n  ⨯ b\n'))
  assert.deepEqual([a.estado()?.pct, a.estado()?.feitos, a.estado()?.total, a.estado()?.passou, a.estado()?.falhou], [50, 2, 4, 1, 1])
  a.receber('out', Buffer.from('  ✓ c\n  ✓ d\n  ✓ e\n'))
  assert.deepEqual([a.estado()?.pct, a.estado()?.feitos], [99, 5]) // passa do total listado: trava em 99
})

test('o total impresso pelo PHPUnit tem precedência sobre o listado', () => {
  const a = acompanharSaida(() => 1)
  a.definirTotal(500)
  a.receber('out', Buffer.from('..  4 / 10 ( 40%)\n'))
  assert.deepEqual([a.estado()?.total, a.estado()?.pct, a.estado()?.feitos], [10, 40, 4])
})

test('pytest com pct impresso não é sobrescrito pelo total listado', () => {
  const a = acompanharSaida(() => 1)
  a.definirTotal(100)
  a.receber('out', Buffer.from('x.py ..  [ 45%]\n'))
  assert.equal(a.estado()?.pct, 45)
})
