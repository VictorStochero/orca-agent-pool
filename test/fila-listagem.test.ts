import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contarListagem, planoDeListagem } from '../src/core/fila/listagem.ts'

const cmd = (s: string) => planoDeListagem(s.split(' '))?.comando.join(' ') ?? null

test('artisan: tira paralelismo, compact e banco; mantém os caminhos', () => {
  assert.equal(
    cmd('php artisan test --parallel --processes=2 --compact --drop-databases tests/Feature/X'),
    'php artisan test --list-tests tests/Feature/X',
  )
})

test('pest/phpunit em todas as grafias do executável', () => {
  assert.equal(cmd('vendor/bin/pest --filter=Foo -p'), 'vendor/bin/pest --list-tests --filter=Foo')
  assert.equal(cmd('./vendor/bin/phpunit --group=a --exclude-group=b'), './vendor/bin/phpunit --list-tests --group=a --exclude-group=b')
  assert.equal(cmd('php vendor\\bin\\pest --testsuite=Unit'), 'php vendor\\bin\\pest --list-tests --testsuite=Unit')
  assert.equal(cmd('./vendor/bin/sail artisan test --parallel'), './vendor/bin/sail artisan test --list-tests')
})

test('--processes separado e flags de execução com valor', () => {
  assert.equal(cmd('php artisan test --parallel --processes 4 tests/Unit'), 'php artisan test --list-tests tests/Unit')
  assert.equal(
    cmd('vendor/bin/pest --coverage --min=80 --stop-on-failure --bail --retry --ci --profile --recreate-databases tests'),
    'vendor/bin/pest --list-tests tests',
  )
})

test('vitest não tem listagem (vitest list não existe antes do 2.0 e o reporter por arquivo não casa com a contagem)', () => {
  for (const c of ['vitest run src/a.test.ts', 'npx vitest run -t nome --maxWorkers=2', 'pnpm vitest run']) assert.equal(cmd(c), null, c)
})

test('pytest, jest, go, cargo, dotnet e desconhecido não têm listagem', () => {
  for (const c of ['pytest -n 4', 'npx jest --maxWorkers=2', 'go test ./...', 'cargo test', 'dotnet test', 'ls -la', 'echo artisan'])
    assert.equal(cmd(c), null, c)
})

test('contagem do PHPUnit/Pest com ANSI e cabeçalho', () => {
  const saida = [
    '\u001b[43;30m  INFO \u001b[49;39m Available tests:',
    '',
    ' - Tests\\Unit\\ExampleTest::test_that_true_is_true',
    ' - Tests\\Unit\\RutaPaletteTest::test_usa_a_cor_da_paleta_que_casa_com_o_track',
    '',
  ].join('\r\n')
  assert.equal(contarListagem('phpunit', saida), 2)
  assert.equal(contarListagem('phpunit', ''), null)
  assert.equal(contarListagem('phpunit', 'Available tests:\n'), null)
})
