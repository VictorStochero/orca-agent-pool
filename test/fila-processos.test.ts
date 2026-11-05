import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { paths } from '../src/core/paths.ts'
import { rodarNaFila, type EventoFila } from '../src/core/fila/rodar.ts'
import { limitarProcessos, processosDoComando } from '../src/core/fila/processos.ts'
import { TETO, listarTestes, publicar, soltarVaga } from '../src/core/fila/travas.ts'
import { arquivos, tmp } from './fila-util.ts'

const lim = (cmd: string, teto = 4, nucleos = 16) => limitarProcessos(cmd.split(' '), teto, nucleos)
const texto = (cmd: string, teto = 4, nucleos = 16) => lim(cmd, teto, nucleos).comando.join(' ')

describe('Laravel / Pest / ParaTest', () => {
  it('--processes=N e --processes N viram min(N, teto)', () => {
    assert.equal(texto('php artisan test --parallel --processes=8 --compact tests/Feature'), 'php artisan test --parallel --processes=4 --compact tests/Feature')
    assert.equal(texto('php artisan test --parallel --processes 8 tests'), 'php artisan test --parallel --processes 4 tests')
    assert.equal(texto('vendor/bin/pest --parallel --processes=16'), 'vendor/bin/pest --parallel --processes=4')
  })
  it('--parallel sem --processes ganha o teto logo depois de --parallel', () => {
    const r = lim('php artisan test --parallel --compact')
    assert.equal(r.comando.join(' '), 'php artisan test --parallel --processes=4 --compact')
    assert.deepEqual(r.ajustes, [{ de: null, para: '--processes=4' }])
  })
  it('dentro de docker compose exec e sail', () => {
    assert.equal(texto('docker compose exec app php artisan test --parallel --processes=8'), 'docker compose exec app php artisan test --parallel --processes=4')
    assert.equal(texto('sail artisan test --parallel'), 'sail artisan test --parallel --processes=4')
  })
  it('--parallel de outro programa não é tocado', () => {
    for (const c of ['pnpm -r --parallel test', './gradlew test --parallel', 'ctest --parallel 8']) assert.equal(texto(c), c)
  })
  it('pedido menor ou igual ao teto fica como veio; sem --parallel não mexe', () => {
    assert.deepEqual(lim('php artisan test --parallel --processes=2'), { comando: 'php artisan test --parallel --processes=2'.split(' '), ajustes: [] })
    assert.equal(texto('php artisan test --parallel --processes=4'), 'php artisan test --parallel --processes=4')
    assert.equal(texto('php artisan test --processes=8 tests'), 'php artisan test --processes=8 tests')
  })
})

describe('pytest-xdist', () => {
  it('-n N, -nN, -n=N, --numprocesses N e =N viram min(N, teto)', () => {
    assert.equal(texto('pytest -n 8 -q'), 'pytest -n 4 -q')
    assert.equal(texto('pytest -n8'), 'pytest -n4')
    assert.equal(texto('python -m pytest -n=8'), 'python -m pytest -n=4')
    assert.equal(texto('uv run pytest --numprocesses 8'), 'uv run pytest --numprocesses 4')
    assert.equal(texto('pytest --numprocesses=8'), 'pytest --numprocesses=4')
  })
  it('auto e logical (16 núcleos) viram o teto; menor fica; sem flag fica', () => {
    assert.equal(texto('pytest -n auto'), 'pytest -n 4')
    assert.equal(texto('pytest -nlogical'), 'pytest -n4')
    assert.equal(texto('pytest --numprocesses=auto'), 'pytest --numprocesses=4')
    assert.equal(texto('pytest -n 2'), 'pytest -n 2')
    assert.equal(texto('pytest -q tests/'), 'pytest -q tests/')
  })
  it('-n de outro programa não é tocado', () => {
    assert.equal(texto('make -n 8'), 'make -n 8')
  })
})

describe('valor simbólico resolvido pelos núcleos', () => {
  it('pytest: auto e logical valem min(núcleos, teto)', () => {
    assert.equal(texto('pytest -n auto', 4, 2), 'pytest -n 2')
    assert.equal(texto('pytest -n auto', 4, 16), 'pytest -n 4')
    assert.equal(texto('pytest --numprocesses=logical', 4, 2), 'pytest --numprocesses=2')
  })
  it('--processes=auto do Laravel vale min(núcleos, teto)', () => {
    assert.equal(texto('php artisan test --parallel --processes=auto', 4, 16), 'php artisan test --parallel --processes=4')
    assert.equal(texto('php artisan test --parallel --processes=auto', 4, 2), 'php artisan test --parallel --processes=2')
  })
  it('percentual do --maxWorkers é fração dos núcleos, limitada pelo teto', () => {
    assert.equal(texto('npx jest --maxWorkers=25%', 8, 16), 'npx jest --maxWorkers=4')
    assert.equal(texto('npx jest --maxWorkers=50%', 4, 16), 'npx jest --maxWorkers=4')
    assert.equal(texto('npx jest --maxWorkers=25%', 8, 2), 'npx jest --maxWorkers=1')
  })
})

describe('vitest / jest', () => {
  it('--maxWorkers=N e --maxWorkers N viram min(N, teto)', () => {
    assert.equal(texto('npx vitest run --maxWorkers=8'), 'npx vitest run --maxWorkers=4')
    assert.equal(texto('npx jest --maxWorkers 8 --ci'), 'npx jest --maxWorkers 4 --ci')
  })
  it('percentual (16 núcleos) limitado pelo teto; menor e ausente ficam', () => {
    assert.equal(texto('npx jest --maxWorkers=50%'), 'npx jest --maxWorkers=4')
    assert.equal(texto('npx jest --maxWorkers 50%'), 'npx jest --maxWorkers 4')
    assert.equal(texto('npx jest --maxWorkers=2'), 'npx jest --maxWorkers=2')
    assert.equal(texto('npx jest --ci'), 'npx jest --ci')
  })
})

describe('demais comandos e valores inválidos', () => {
  it('ficam como vieram', () => {
    for (const c of ['go test -p 16 ./...', 'cargo test -- --test-threads=16', 'dotnet test -m:16', 'npm test']) assert.equal(texto(c), c)
    assert.equal(texto('pytest -n 8', 0), 'pytest -n 8')
  })
  it('o aviso traz o de/para como o agente escreveu', () => {
    assert.deepEqual(lim('php artisan test --parallel --processes=8').ajustes, [{ de: '--processes=8', para: '--processes=4' }])
    assert.deepEqual(lim('pytest -n 8').ajustes, [{ de: '-n 8', para: '-n 4' }])
  })
})

describe('processosDoComando', () => {
  it('lê --processes=N e --processes N', () => {
    assert.equal(processosDoComando(['php', 'artisan', 'test', '--parallel', '--processes=4']), 4)
    assert.equal(processosDoComando(['php', 'artisan', 'test', '--processes', '3']), 3)
    assert.equal(processosDoComando(['php', 'artisan', 'test']), null)
  })
})

describe('rodarNaFila com comando explícito', () => {
  const cfg = (processos: number) => ({ modo: 'banco' as const, vagas: 2, vagasPorProjeto: 1, teto: 3, processos, esperaMaxS: 300 })
  const script = 'require("fs").writeFileSync(process.env.SAIDA, JSON.stringify(process.argv.slice(1)))'

  it('lança o comando ajustado pelo fila.processos relido e avisa', async () => {
    const saida = join(tmp(), 'argv.json')
    const eventos: EventoFila[] = []
    const c = cfg(8)
    const cod = await rodarNaFila({
      dir: tmp(), comando: [process.execPath, '-e', script, 'artisan', '--parallel', '--processes=8'], config: c, p: paths(tmp()),
      env: { SAIDA: saida }, lerConfig: () => cfg(4), avisar: (e) => eventos.push(e)
    })
    assert.equal(cod, 0)
    assert.deepEqual(JSON.parse(readFileSync(saida, 'utf8')), ['artisan', '--parallel', '--processes=4'])
    assert.deepEqual(eventos, [{ codigo: 'processos_ajustados', de: '--processes=8', para: '--processes=4' }])
  })

  it('pedido menor que o teto roda como veio, sem aviso', async () => {
    const saida = join(tmp(), 'argv.json')
    const eventos: EventoFila[] = []
    await rodarNaFila({
      dir: tmp(), comando: [process.execPath, '-e', script, 'artisan', '--parallel', '--processes=2'], config: cfg(4), p: paths(tmp()),
      env: { SAIDA: saida }, avisar: (e) => eventos.push(e)
    })
    assert.deepEqual(JSON.parse(readFileSync(saida, 'utf8')), ['artisan', '--parallel', '--processes=2'])
    assert.deepEqual(eventos, [])
  })

  it('espera e trava mostram o comando que vai ser lançado, não o pedido', async () => {
    const p = paths(tmp())
    const saida = join(tmp(), 'trava.json')
    const teto = join(p.fila, TETO)
    assert.ok(publicar(join(teto, '1'), { pid: process.pid }))
    let atual = { ...cfg(6), teto: 1 }
    const esperas: (string | null | undefined)[] = []
    // O filho só lê a trava depois que o pai anota o filho nela (a anotação traz o comando lançado).
    const leTrava = `const fs = require('fs'); const fim = Date.now() + 5000; let s
do { try { s = fs.readFileSync(process.env.TRAVA, 'utf8'); if (JSON.parse(s).filho) break } catch {} Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20) } while (Date.now() < fim)
fs.writeFileSync(process.env.SAIDA, s)`
    const code = await rodarNaFila({
      dir: tmp(), config: atual, p, lerConfig: () => atual,
      comando: [process.execPath, '-e', leTrava, 'artisan', '--parallel', '--processes=8'],
      env: { SAIDA: saida, TRAVA: join(p.fila, 'geral', '1', 'info.json') },
      // Na espera do teto a config cai de 6 para 4: a espera e a trava (gravada com 6) acompanham.
      dormir: async () => {
        esperas.push(listarTestes(p).find((t) => t.estado === 'aguardando')?.comando)
        if (esperas.length === 1) atual = { ...atual, processos: 4 }
        else soltarVaga(teto, 1)
      }
    })
    assert.equal(code, 0)
    assert.deepEqual(esperas.map((c) => c?.match(/--processes=\d+$/)?.[0]), ['--processes=6', '--processes=4'])
    assert.match(JSON.parse(readFileSync(saida, 'utf8')).comando, /--processes=4$/)
  })
})

describe('rodarNaFila sem comando (executor detectado)', () => {
  it('a espera acompanha o fila.processos relido', async () => {
    const p = paths(tmp())
    assert.ok(publicar(join(p.fila, TETO, '1'), { pid: process.pid }))
    let atual = { modo: 'banco' as const, vagas: 2, vagasPorProjeto: 1, teto: 1, processos: 6, esperaMaxS: 1 }
    const esperas: (string | null | undefined)[] = []
    let t = 0
    // O teto fica ocupado e a espera estoura (75): só a linha aguardando importa, sem lançar php.
    const code = await rodarNaFila({
      dir: arquivos(tmp(), { artisan: '' }), config: atual, p, env: {}, lerConfig: () => atual, agora: () => t,
      dormir: async (ms) => {
        t += ms
        esperas.push(listarTestes(p).find((x) => x.estado === 'aguardando')?.comando)
        atual = { ...atual, processos: 4 }
      }
    })
    assert.equal(code, 75)
    assert.match(esperas[0] ?? '', /--parallel --processes=6$/)
    assert.match(esperas.at(-1) ?? '', /--parallel --processes=4$/)
  })
})
