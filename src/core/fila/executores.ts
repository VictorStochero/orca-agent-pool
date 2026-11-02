import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type Executor = { nome: string; comando: string[]; paralelo(n: number): string[] }

const nenhum = (): string[] => []

function ler(dir: string, ...rel: string[]): string | null {
  try {
    return readFileSync(join(dir, ...rel), 'utf8')
  } catch {
    return null
  }
}

function laravel(dir: string): Executor {
  const sail = join(dir, 'vendor', 'bin', 'sail')
  const compose = `${ler(dir, 'docker-compose.yml') ?? ''}${ler(dir, 'compose.yaml') ?? ''}`
  const comando = existsSync(join(dir, '.ddev', 'config.yaml'))
    ? ['ddev', 'artisan', 'test']
    : existsSync(sail) && compose.includes('sail')
      ? ['./vendor/bin/sail', 'artisan', 'test']
      : ['php', 'artisan', 'test']
  return { nome: 'laravel', comando, paralelo: (n) => ['--parallel', `--processes=${n}`] }
}

function python(dir: string): Executor {
  const venv = ['bin/pytest', 'Scripts/pytest.exe'].map((r) => join(dir, '.venv', r)).find(existsSync)
  const comando = existsSync(join(dir, 'uv.lock'))
    ? ['uv', 'run', 'pytest']
    : existsSync(join(dir, 'poetry.lock'))
      ? ['poetry', 'run', 'pytest']
      : existsSync(join(dir, 'Pipfile.lock'))
        ? ['pipenv', 'run', 'pytest']
        : venv
          ? [venv]
          : ['python', '-m', 'pytest']
  const fontes = ['pyproject.toml', 'Pipfile', 'uv.lock', 'poetry.lock', ...readdirSync(dir).filter((f) => /^requirements.*\.txt$/.test(f))]
  const xdist = fontes.some((f) => /pytest[-_]xdist/.test(ler(dir, f) ?? ''))
  return { nome: 'python', comando, paralelo: (n) => (xdist ? ['-n', String(n)] : []) }
}

function js(dir: string): Executor {
  const comando = existsSync(join(dir, 'pnpm-lock.yaml'))
    ? ['pnpm', 'test']
    : existsSync(join(dir, 'yarn.lock'))
      ? ['yarn', 'test']
      : existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))
        ? ['bun', 'run', 'test']
        : ['npm', 'test', '--']
  let pkg: { scripts?: Record<string, string>; dependencies?: object; devDependencies?: object } = {}
  try {
    pkg = JSON.parse(ler(dir, 'package.json') ?? '{}')
  } catch {
    // package.json inválido: segue sem paralelismo
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, unknown>
  const runner = ['vitest', 'jest'].some((r) => r in deps || (pkg.scripts?.test ?? '').includes(r))
  return { nome: 'js', comando, paralelo: (n) => (runner ? [`--maxWorkers=${n}`] : []) }
}

/** Executor do projeto pela tabela da spec §4.3; AGENT_POOL_RUNNER substitui a detecção (ex.: comando em container). */
export function detectarExecutor(dir: string, env: NodeJS.ProcessEnv): Executor | null {
  const runner = env.AGENT_POOL_RUNNER?.trim()
  if (runner) return { nome: 'custom', comando: runner.split(/\s+/), paralelo: nenhum }
  const tem = (f: string) => existsSync(join(dir, f))
  const arquivos = readdirSync(dir)
  if (tem('artisan')) return laravel(dir)
  if (tem('pyproject.toml') || tem('pytest.ini') || tem('Pipfile') || arquivos.some((f) => /^requirements.*\.txt$/.test(f))) return python(dir)
  if (tem('package.json')) return js(dir)
  if (tem('go.mod')) return { nome: 'go', comando: ['go', 'test', './...'], paralelo: (n) => ['-p', String(n)] }
  if (tem('Cargo.toml')) return { nome: 'rust', comando: ['cargo', 'test'], paralelo: (n) => ['--', `--test-threads=${n}`] }
  if (arquivos.some((f) => /\.(csproj|sln)$/.test(f))) return { nome: 'dotnet', comando: ['dotnet', 'test'], paralelo: (n) => [`-m:${n}`] }
  if (tem('Gemfile') && tem('spec')) return { nome: 'ruby', comando: ['bundle', 'exec', 'rspec'], paralelo: nenhum }
  return null
}
