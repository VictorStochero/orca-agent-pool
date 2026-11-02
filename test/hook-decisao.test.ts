import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decidir } from '../src/core/hook/decisao.ts'

const nega = (comando: string, agente: 'claude' | 'codex' = 'claude') => decidir({ comando, agente }).permitir === false
const livres = (...cs: string[]) => cs.forEach((c) => assert.equal(decidir({ comando: c, agente: 'claude' }).permitir, true, c))
const bloqueados = (...cs: string[]) => cs.forEach((c) => assert.equal(nega(c), true, c))

describe('decidir', () => {
  it('nega teste fora da fila e sugere agent-pool test -- <comando>', () => {
    for (const c of ['php artisan test', 'pytest -q', 'npm test', 'go test ./...']) {
      const d = decidir({ comando: c, agente: 'claude' })
      assert.equal(d.permitir, false, c)
      assert.equal(d.trecho, c)
    }
  })
  it('permite mensagem e texto que só citam teste', () => {
    livres('git commit -m "rode pytest"', 'echo npm test', 'git commit -am "fix: roda pytest"', 'git status',
      'orca orchestration send --body "rode pytest" --type x', 'gh pr comment 2 --body "npm test ok"',
      'git commit -m "x" && git status', 'composer install', 'npm ci', 'pip install pytest')
  })
  it('permite o que já passa pela fila', () => {
    livres('agent-pool test -- php artisan test', '~/.agents/bin/agent-pool test -- pytest -x', 'agent-pool.cmd test -- npm test',
      'bash -lc "agent-pool test -- python -m pytest"', "& 'C:/Program Files/Git/bin/bash.exe' -lc 'agent-pool test -- pytest'")
    bloqueados('agent-pool test -- pytest; pytest', 'php artisan test # agent-pool test')
  })
  it('cobre as stacks e os invólucros', () => {
    bloqueados('npm ci && npm test', 'pytest -x', 'composer test', 'cargo test', 'bash -c "pytest"', 'npx vitest run',
      'php vendor/pestphp/pest/bin/pest', 'python -m unittest', 'pnpm exec vitest run', 'git commit -m "x" && pytest',
      'python -m pytest -m "not slow"', 'yarn test:unit', 'dotnet test', 'bundle exec rspec', 'uv run pytest',
      'FOO=1 vendor/bin/phpunit', 'python manage.py test', 'cd app\nnpm test', 'composer install\nphp artisan test')
  })
  it('enxerga substituição de comando, mas não texto em aspas simples', () => {
    bloqueados('out=$(npm test)', 'echo "$(pytest)"', 'echo `npm test`', 'grep "$(php artisan test)" README.md')
    livres("grep '$(php artisan test)' README.md", 'grep -l -E "artisan test|pest" *.yml')
  })
  it('lista de testes e migração de outro ambiente passam', () => {
    livres('php artisan test --list-tests', 'pytest --collect-only', 'npx vitest list', 'npx jest --listTests',
      'php artisan migrate:fresh --force', 'php artisan migrate --env=testing_extra', 'python manage.py migrate',
      'php artisan migrate --env=local && echo --env=testing', 'agent-pool test -- php artisan migrate --env=testing')
  })
  it('migração/limpeza de banco de teste fora da fila é negada', () => {
    bloqueados('php artisan migrate --env=testing --force', 'php artisan db:wipe --env="testing"', 'php artisan migrate --database=mysql_test',
      'python manage.py flush --settings app.test_settings', 'php artisan migrate --env=local && php artisan db:seed --env=testing')
  })
  it('o trecho sugerido preserva o redirecionamento 2>&1', () => {
    assert.equal(decidir({ comando: 'npm test 2>&1 | tail -5', agente: 'claude' }).trecho, 'npm test 2>&1')
    assert.equal(decidir({ comando: 'cd api && pytest -q &> /dev/null', agente: 'claude' }).trecho, 'pytest -q &> /dev/null')
  })
  it('formas comuns de rodar teste também são negadas', () => {
    bloqueados('npm t', 'pnpm t', 'env CI=1 pytest', '(cd api && pytest)', '{ pytest; }', 'docker compose exec app php artisan test',
      'podman exec app pytest', 'ddev artisan test', 'cargo nextest run')
    livres('docker compose up -d', 'ddev start', 'cargo build', 'env FOO=1 ls')
  })
  it('vale igual para o Codex', () => {
    assert.equal(nega('bash -lc "pytest -x"', 'codex'), true)
  })
})
