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

test('vitest run vira vitest list com os mesmos filtros', () => {
  assert.equal(cmd('vitest run src/a.test.ts'), 'vitest list src/a.test.ts')
  assert.equal(cmd('npx vitest run -t nome --maxWorkers=2'), 'npx vitest list -t nome')
  assert.equal(cmd('pnpm vitest run'), 'pnpm vitest list')
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

test('contagem do vitest list ignora avisos e cabeçalho', () => {
  const saida = 'aviso qualquer\ntests/a.test.ts > soma > soma 1+1\ntests/a.test.ts > soma > soma 2+2\ntests/b.test.ts > roda\n\n'
  assert.equal(contarListagem('vitest', saida), 3)
  assert.equal(contarListagem('vitest', 'nada\n'), null)
})
