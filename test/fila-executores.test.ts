import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectarExecutor } from '../src/core/fila/executores.ts'
import { arquivos, tmp } from './fila-util.ts'

const exec = (mapa: Record<string, string>, env: NodeJS.ProcessEnv = {}) => detectarExecutor(arquivos(tmp(), mapa), env)

test('laravel: php artisan test com --parallel --processes=N', () => {
  const e = exec({ artisan: '' })!
  assert.deepEqual(e.comando, ['php', 'artisan', 'test'])
  assert.deepEqual(e.paralelo(8), ['--parallel', '--processes=8'])
})

test('laravel: ddev e sail', () => {
  assert.deepEqual(exec({ artisan: '', '.ddev/config.yaml': '' })!.comando, ['ddev', 'artisan', 'test'])
  const sail = exec({ artisan: '', 'vendor/bin/sail': '', 'docker-compose.yml': 'services:\n  laravel.test:\n    image: sail-8.3/app' })!
  assert.equal(sail.comando[1], 'artisan')
  assert.match(sail.comando[0], /sail$/)
})

test('python: runner por lockfile e -n só com xdist', () => {
  assert.deepEqual(exec({ 'pyproject.toml': '', 'uv.lock': '' })!.comando, ['uv', 'run', 'pytest'])
  assert.deepEqual(exec({ 'pyproject.toml': '', 'poetry.lock': '' })!.comando, ['poetry', 'run', 'pytest'])
  assert.deepEqual(exec({ Pipfile: '', 'Pipfile.lock': '' })!.comando, ['pipenv', 'run', 'pytest'])
  assert.deepEqual(exec({ 'requirements-dev.txt': 'pytest' })!.comando, ['python', '-m', 'pytest'])
  assert.deepEqual(exec({ 'pytest.ini': '' })!.paralelo(4), [])
  assert.deepEqual(exec({ 'requirements.txt': 'pytest\npytest-xdist\n' })!.paralelo(4), ['-n', '4'])
})

test('python: .venv do projeto', () => {
  const e = exec({ 'pyproject.toml': '', '.venv/bin/pytest': '', '.venv/Scripts/pytest.exe': '' })!
  assert.match(e.comando[0], /\.venv/)
  assert.equal(e.comando.length, 1)
})

test('js: gerenciador pelo lockfile; --maxWorkers só com vitest/jest', () => {
  const pkg = (extra: object = {}) => JSON.stringify({ scripts: { test: 'x' }, ...extra })
  assert.deepEqual(exec({ 'package.json': pkg(), 'pnpm-lock.yaml': '' })!.comando, ['pnpm', 'test'])
  assert.deepEqual(exec({ 'package.json': pkg(), 'yarn.lock': '' })!.comando, ['yarn', 'test'])
  assert.deepEqual(exec({ 'package.json': pkg(), 'bun.lock': '' })!.comando, ['bun', 'run', 'test'])
  assert.deepEqual(exec({ 'package.json': pkg(), 'package-lock.json': '' })!.comando, ['npm', 'test', '--'])
  assert.deepEqual(exec({ 'package.json': pkg() })!.paralelo(3), [])
  assert.deepEqual(exec({ 'package.json': pkg({ devDependencies: { vitest: '3' } }) })!.paralelo(3), ['--maxWorkers=3'])
  assert.deepEqual(exec({ 'package.json': pkg({ devDependencies: { jest: '30' } }) })!.paralelo(3), ['--maxWorkers=3'])
})

test('go, cargo, dotnet, rspec', () => {
  const go = exec({ 'go.mod': '' })!
  assert.deepEqual(go.comando, ['go', 'test', './...'])
  assert.deepEqual(go.paralelo(5), ['-p', '5'])
  const cargo = exec({ 'Cargo.toml': '' })!
  assert.deepEqual(cargo.comando, ['cargo', 'test'])
  assert.deepEqual(cargo.paralelo(5), ['--', '--test-threads=5'])
  const dn = exec({ 'App.csproj': '' })!
  assert.deepEqual(dn.comando, ['dotnet', 'test'])
  assert.deepEqual(dn.paralelo(5), ['-m:5'])
  assert.equal(exec({ 'App.sln': '' })!.nome, dn.nome)
  const rs = exec({ Gemfile: '', 'spec/a_spec.rb': '' })!
  assert.deepEqual(rs.comando, ['bundle', 'exec', 'rspec'])
  assert.deepEqual(rs.paralelo(5), [])
})

test('Gemfile sem spec/ e diretório vazio não têm executor', () => {
  assert.equal(exec({ Gemfile: '' }), null)
  assert.equal(exec({}), null)
})

test('laravel vence package.json; AGENT_POOL_RUNNER vence tudo', () => {
  assert.deepEqual(exec({ artisan: '', 'package.json': '{}' })!.comando.slice(0, 2), ['php', 'artisan'])
  const e = exec({ artisan: '' }, { AGENT_POOL_RUNNER: 'docker compose exec -T web pytest' })!
  assert.deepEqual(e.comando, ['docker', 'compose', 'exec', '-T', 'web', 'pytest'])
  assert.deepEqual(e.paralelo(8), [])
})
