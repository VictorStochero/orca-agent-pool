import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

/** Comando do primeiro arquivo da tabela que existe em `dir`; `padrao` se nenhum. */
function primeiroQueExiste(dir: string, tabela: [string[], string[]][], padrao: string[]): string[] {
  return tabela.find(([arquivos]) => arquivos.some(f => existsSync(join(dir, f))))?.[1] ?? padrao
}

function laravel(dir: string): Executor {
  const compose = `${ler(dir, 'docker-compose.yml') ?? ''}${ler(dir, 'compose.yaml') ?? ''}`
  const comSail = existsSync(join(dir, 'vendor', 'bin', 'sail')) && compose.includes('sail')
  const comando = primeiroQueExiste(
    dir,
    [[['.ddev/config.yaml'], ['ddev', 'artisan', 'test']]],
    comSail ? ['./vendor/bin/sail', 'artisan', 'test'] : ['php', 'artisan', 'test'],
  )
  return { nome: 'laravel', comando, paralelo: n => ['--parallel', `--processes=${n}`] }
}

function python(dir: string): Executor {
  const venv = ['bin/pytest', 'Scripts/pytest.exe'].map(r => join(dir, '.venv', r)).find(existsSync)
  const comando = primeiroQueExiste(
    dir,
    [
      [['uv.lock'], ['uv', 'run', 'pytest']],
      [['poetry.lock'], ['poetry', 'run', 'pytest']],
      [['Pipfile.lock'], ['pipenv', 'run', 'pytest']],
    ],
    venv ? [venv] : ['python', '-m', 'pytest'],
  )
  const fontes = ['pyproject.toml', 'Pipfile', 'uv.lock', 'poetry.lock', ...readdirSync(dir).filter(f => /^requirements.*\.txt$/.test(f))]
  const xdist = fontes.some(f => /pytest[-_]xdist/.test(ler(dir, f) ?? ''))
  return { nome: 'python', comando, paralelo: n => (xdist ? ['-n', String(n)] : []) }
}

function js(dir: string): Executor {
  const comando = primeiroQueExiste(
    dir,
    [
      [['pnpm-lock.yaml'], ['pnpm', 'test']],
      [['yarn.lock'], ['yarn', 'test']],
      [
        ['bun.lock', 'bun.lockb'],
        ['bun', 'run', 'test'],
      ],
    ],
    ['npm', 'test', '--'],
  )
  let pkg: { scripts?: Record<string, string>; dependencies?: object; devDependencies?: object } = {}
  try {
    pkg = JSON.parse(ler(dir, 'package.json') ?? '{}')
  } catch {
    // package.json inválido: segue sem paralelismo
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, unknown>
  const runner = ['vitest', 'jest'].some(r => r in deps || (pkg.scripts?.test ?? '').includes(r))
  return { nome: 'js', comando, paralelo: n => (runner ? [`--maxWorkers=${n}`] : []) }
}

/** Executor do projeto pela tabela da spec §4.3. */
export function detectarExecutor(dir: string): Executor | null {
  const tem = (f: string) => existsSync(join(dir, f))
  const arquivos = readdirSync(dir)
  if (tem('artisan')) return laravel(dir)
  if (tem('pyproject.toml') || tem('pytest.ini') || tem('Pipfile') || arquivos.some(f => /^requirements.*\.txt$/.test(f)))
    return python(dir)
  if (tem('package.json')) return js(dir)
  if (tem('go.mod')) return { nome: 'go', comando: ['go', 'test', './...'], paralelo: n => ['-p', String(n)] }
  if (tem('Cargo.toml')) return { nome: 'rust', comando: ['cargo', 'test'], paralelo: n => ['--', `--test-threads=${n}`] }
  if (arquivos.some(f => /\.(csproj|sln)$/.test(f))) return { nome: 'dotnet', comando: ['dotnet', 'test'], paralelo: n => [`-m:${n}`] }
  if (tem('Gemfile') && tem('spec')) return { nome: 'ruby', comando: ['bundle', 'exec', 'rspec'], paralelo: nenhum }
  return null
}
