import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ConfigFila } from '../src/core/tipos.ts'
import { paths } from '../src/core/paths.ts'
import { chaveFila } from '../src/core/fila/recurso.ts'
import { listarTestes, orfaoVivo, publicar, type InfoTrava } from '../src/core/fila/travas.ts'
import { rodarNaFila } from '../src/core/fila/rodar.ts'
import { arquivos, pidMorto, tmp } from './fila-util.ts'
import { envCasa } from './helpers/casa.ts'

const cfg = (o: Partial<ConfigFila> = {}): ConfigFila =>
  ({ modo: 'banco', vagas: 2, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 300, ...o })
const sai = (n: number) => [process.execPath, '-e', `process.exit(${n})`]

/** Relógio falso: dormir avança o tempo e chama `ao` (para espiar o estado durante a espera). */
function relogio(ao?: () => void) {
  let t = 1_000_000
  return { agora: () => t, dormir: async (ms: number) => { t += ms; ao?.() } }
}

function ocupar(raiz: string, chave: string, vaga: number, pid: number, extra: Partial<InfoTrava> = {}) {
  const info: InfoTrava = { pid, inicio: 1, recurso: 'geral', worktree: '/w', projeto: 'p', comando: 'x', fila: chave, ...extra }
  assert.ok(publicar(join(raiz, chave, String(vaga)), info))
}

test('devolve o código do teste e libera vaga, teto e espera', async () => {
  const p = paths(tmp())
  assert.equal(await rodarNaFila({ dir: tmp(), comando: sai(7), config: cfg(), p, env: {} }), 7)
  assert.deepEqual(listarTestes(p), [])
  const vagas = (readdirSync(p.fila, { recursive: true }) as string[]).filter((f) => /(^|[\\/])\d+$/.test(f))
  assert.deepEqual(vagas, [])
  assert.deepEqual(existsSync(p.espera) ? readdirSync(p.espera) : [], [])
})

test('comando inexistente sai 127 e libera tudo', async () => {
  const p = paths(tmp())
  assert.equal(await rodarNaFila({ dir: tmp(), comando: ['nao-existe-agent-pool-xyz'], config: cfg(), p, env: {} }), 127)
  assert.deepEqual(listarTestes(p), [])
})

test('roda gerenciador de pacotes (npm) sem shell do usuário', async () => {
  const p = paths(tmp())
  assert.equal(await rodarNaFila({ dir: tmp(), comando: ['npm', '--version'], config: cfg(), p, env: process.env }), 0)
})

test('sem comando e sem executor detectado sai 2', async () => {
  assert.equal(await rodarNaFila({ dir: tmp(), config: cfg(), p: paths(tmp()), env: {} }), 2)
})

test('global serializa recursos diferentes; banco não', async () => {
  const dirA = arquivos(tmp(), { '.env': 'DB_PORT=3306' })
  const dirB = arquivos(tmp(), { '.env': 'DB_PORT=3307' })
  const pg = paths(tmp())
  ocupar(pg.fila, chaveFila('global', 'x', 'x'), 1, process.pid)
  const r1 = relogio()
  assert.equal(await rodarNaFila({ dir: dirB, comando: sai(0), config: cfg({ modo: 'global', vagas: 1, esperaMaxS: 2 }), p: pg, env: {}, ...r1 }), 75)

  const pb = paths(tmp())
  ocupar(pb.fila, chaveFila('banco', 'mysql 127.0.0.1:3306', 'x'), 1, process.pid)
  const c = cfg({ modo: 'banco', vagas: 1, esperaMaxS: 2 })
  assert.equal(await rodarNaFila({ dir: dirB, comando: sai(0), config: c, p: pb, env: {}, ...relogio() }), 0)
  assert.equal(await rodarNaFila({ dir: dirA, comando: sai(0), config: c, p: pb, env: {}, ...relogio() }), 75)
})

test('projeto separa por projeto', async () => {
  const p = paths(tmp())
  const a = join(tmp(), 'proj-a'); mkdirSync(a)
  const b = join(tmp(), 'proj-b'); mkdirSync(b)
  ocupar(p.fila, chaveFila('projeto', 'geral', 'proj-a'), 1, process.pid)
  const c = cfg({ modo: 'projeto', vagasPorProjeto: 1, esperaMaxS: 2 })
  assert.equal(await rodarNaFila({ dir: b, comando: sai(0), config: c, p, env: {}, ...relogio() }), 0)
  assert.equal(await rodarNaFila({ dir: a, comando: sai(0), config: c, p, env: {}, ...relogio() }), 75)
})

test('teto vale nos três modos', async () => {
  for (const modo of ['global', 'banco', 'projeto'] as const) {
    const p = paths(tmp())
    ocupar(p.fila, '_teto', 1, process.pid)
    ocupar(p.fila, '_teto', 2, process.pid)
    const c = cfg({ modo, teto: 2, esperaMaxS: 2 })
    assert.equal(await rodarNaFila({ dir: tmp(), comando: sai(0), config: c, p, env: {}, ...relogio() }), 75, modo)
    assert.equal(existsSync(join(p.fila, 'geral', '1')), false, 'vaga da fila liberada ao estourar no teto')
  }
})

test('espera esgotada sai 75, mostra aguardando com desde_ts e apaga o registro', async () => {
  const p = paths(tmp())
  const chave = chaveFila('banco', 'geral', 'x')
  ocupar(p.fila, chave, 1, process.pid)
  const vistos: ReturnType<typeof listarTestes>[] = []
  const r = relogio(() => vistos.push(listarTestes(p)))
  const code = await rodarNaFila({ dir: tmp(), comando: sai(0), config: cfg({ vagas: 1, esperaMaxS: 3 }), p, env: {}, ...r })
  assert.equal(code, 75)
  const espera = vistos.flat().find((t) => t.estado === 'aguardando')!
  assert.ok(espera, 'apareceu como aguardando')
  assert.equal(espera.pid, process.pid)
  assert.equal(typeof espera.desde_ts, 'number')
  assert.equal(espera.recurso, 'geral')
  assert.equal(readdirSync(p.espera).length, 0)
})

test('listarTestes: ordem execucao, aguardando, parado; do mais antigo', () => {
  const p = paths(tmp())
  const morto = pidMorto()
  ocupar(p.fila, 'geral', 1, process.pid, { inicio: 20 })
  ocupar(p.fila, 'geral', 2, process.pid, { inicio: 10 })
  ocupar(p.fila, 'outra', 1, morto, { inicio: 5 })
  for (const [pid, ts] of [[process.pid + 1, 7], [process.pid + 2, 3]] as const) {
    mkdirSync(join(p.espera, String(pid)), { recursive: true })
    writeFileSync(join(p.espera, String(pid), 'info.json'), JSON.stringify({ pid, inicio: ts, recurso: 'geral', worktree: '/w', projeto: 'p', comando: 'x', fila: 'geral' }))
  }
  const vivo = (pid: number) => pid !== morto
  const l = listarTestes(p, vivo)
  assert.deepEqual(l.map((t) => [t.estado, t.desde_ts]), [['execucao', 10], ['execucao', 20], ['aguardando', 3], ['aguardando', 7], ['parado', 5]])
  assert.equal(l[0].vaga, 2)
})

test('pid morto: trava vira parado e o próximo rodarNaFila recupera a vaga', async () => {
  const p = paths(tmp())
  const morto = pidMorto()
  ocupar(p.fila, chaveFila('banco', 'geral', 'x'), 1, morto)
  assert.equal(listarTestes(p)[0].estado, 'parado')
  const code = await rodarNaFila({ dir: tmp(), comando: sai(0), config: cfg({ vagas: 1, esperaMaxS: 2 }), p, env: {}, ...relogio() })
  assert.equal(code, 0)
  assert.deepEqual(listarTestes(p), [])
})

test('dois rodarNaFila concorrentes com 1 vaga nunca rodam juntos', async () => {
  const home = tmp()
  const log = join(tmp(), 'log.txt')
  writeFileSync(log, '')
  const filho = join(import.meta.dirname, 'fila-filho.ts')
  const sobe = () => new Promise<number>((res, rej) => {
    const c = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', filho, home, tmp(), log], { stdio: 'inherit', env: envCasa(home) })
    c.on('error', rej)
    c.on('close', (code) => res(code ?? -1))
  })
  assert.deepEqual(await Promise.all([sobe(), sobe()]), [0, 0])
  assert.equal(readFileSync(log, 'utf8'), 'in\nout\nin\nout\n')
})

test('listarTestes: teste que segura a vaga e espera o teto aparece uma vez, como aguardando', () => {
  const p = paths(tmp())
  ocupar(p.fila, 'fila-x-3307', 1, process.pid, { inicio: 10 })
  mkdirSync(join(p.espera, String(process.pid)), { recursive: true })
  writeFileSync(join(p.espera, String(process.pid), 'info.json'), JSON.stringify({ pid: process.pid, inicio: 12, recurso: '3307', worktree: '/w', projeto: 'p', comando: 'x', fila: '_teto' }))
  const l = listarTestes(p)
  assert.deepEqual(l.map((t) => [t.pid, t.estado]), [[process.pid, 'aguardando']])
})

test('modo banco: 1 vaga por banco mesmo com fila.vagas 2; outro banco roda', async () => {
  const a = arquivos(tmp(), { '.env': 'DB_PORT=3306\nDB_DATABASE=app_testing' })
  const b = arquivos(tmp(), { '.env': 'DB_PORT=3306\nDB_DATABASE=outro' })
  const p = paths(tmp())
  ocupar(p.fila, chaveFila('banco', 'mysql 127.0.0.1:3306/app_testing', 'x'), 1, process.pid)
  const c = cfg({ modo: 'banco', vagas: 2, esperaMaxS: 2 })
  assert.equal(await rodarNaFila({ dir: a, comando: sai(0), config: c, p, env: {}, ...relogio() }), 75)
  assert.equal(await rodarNaFila({ dir: b, comando: sai(0), config: c, p, env: {}, ...relogio() }), 0)
})

test('modo banco: recurso geral segue fila.vagas (2), só banco tem 1 vaga', async () => {
  const d = arquivos(tmp(), {})
  const p = paths(tmp())
  ocupar(p.fila, chaveFila('banco', 'geral', 'x'), 1, process.pid)
  assert.equal(await rodarNaFila({ dir: d, comando: sai(0), config: cfg({ vagas: 2, esperaMaxS: 2 }), p, env: {}, ...relogio() }), 0)
})

test('VAR=valor de banco na frente do comando define a fila (modo banco)', async () => {
  const d = arquivos(tmp(), { '.env': 'DB_PORT=3306\nDB_DATABASE=a' })
  const p = paths(tmp())
  ocupar(p.fila, chaveFila('banco', 'mysql 127.0.0.1:3306/b', 'x'), 1, process.pid)
  const comando = ['DB_DATABASE=b', process.execPath, '-e', '0']
  assert.equal(await rodarNaFila({ dir: d, comando, config: cfg({ esperaMaxS: 1 }), p, env: {}, ...relogio() }), 75)
})

test('VAR=valor na frente do comando vai para o env do filho', async () => {
  const p = paths(tmp())
  const comando = ['X=7', process.execPath, '-e', "process.exit(process.env.X === '7' ? 0 : 3)"]
  assert.equal(await rodarNaFila({ dir: tmp(), comando, config: cfg(), p, env: {} }), 0)
})

const FILHO = { pid: 4242, inicio: 1_000 }

test('listarTestes: dono morto com filho órfão vivo segue em execucao', () => {
  const p = paths(tmp())
  ocupar(p.fila, 'geral', 1, pidMorto(), { filho: FILHO })
  assert.equal(listarTestes(p, () => false, () => true)[0].estado, 'execucao')
  assert.equal(listarTestes(p, () => false, () => false)[0].estado, 'parado')
})

test('listarTestes: dono morto sem filho é parado sem consultar o órfão', () => {
  const p = paths(tmp())
  ocupar(p.fila, 'geral', 1, pidMorto())
  const orfao = () => assert.fail('não deveria consultar')
  assert.equal(listarTestes(p, () => false, orfao)[0].estado, 'parado')
})

test('rodarNaFila: vaga de dono morto com órfão vivo não é recuperada (sai 75)', async () => {
  const p = paths(tmp())
  const morto = pidMorto()
  const dir = join(p.fila, chaveFila('banco', 'geral', 'x'), '1')
  ocupar(p.fila, chaveFila('banco', 'geral', 'x'), 1, morto, { filho: FILHO })
  const code = await rodarNaFila({ dir: tmp(), comando: sai(0), config: cfg({ vagas: 1, esperaMaxS: 2 }), p, env: {}, orfao: () => true, ...relogio() })
  assert.equal(code, 75)
  assert.equal(JSON.parse(readFileSync(join(dir, 'info.json'), 'utf8')).pid, morto)
})

test('rodarNaFila: vaga de dono morto com órfão morto é recuperada', async () => {
  const p = paths(tmp())
  ocupar(p.fila, chaveFila('banco', 'geral', 'x'), 1, pidMorto(), { filho: FILHO })
  const code = await rodarNaFila({ dir: tmp(), comando: sai(0), config: cfg({ vagas: 1, esperaMaxS: 2 }), p, env: {}, orfao: () => false, ...relogio() })
  assert.equal(code, 0)
})

test('rodarNaFila anota o filho (pid e hora) na vaga da fila e na do teto', async () => {
  const p = paths(tmp())
  const saida = join(tmp(), 'filhos.json')
  const script = `const fs=require('fs'),path=require('path');const r=[];
const ach=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const c=path.join(d,e.name);
if(e.isDirectory()&&!e.name.startsWith('.'))ach(c);else if(e.name==='info.json')r.push([path.basename(d),path.basename(path.dirname(d)),JSON.parse(fs.readFileSync(c,'utf8')).filho])}};
ach(process.argv[1]);fs.writeFileSync(process.argv[2],JSON.stringify(r))`
  const code = await rodarNaFila({ dir: tmp(), comando: [process.execPath, '-e', script, p.fila, saida], config: cfg(), p, env: {}, agora: () => 5_000 })
  assert.equal(code, 0)
  const r = JSON.parse(readFileSync(saida, 'utf8')) as [string, string, { pid: number; inicio: number } | undefined][]
  assert.equal(r.length, 2)
  assert.deepEqual(r.map((x) => x[1]).sort(), ['_teto', chaveFila('banco', 'geral', 'x')].sort())
  for (const [, , filho] of r) {
    assert.ok(Number.isInteger(filho?.pid) && filho!.pid > 0)
    assert.equal(filho!.inicio, 5_000)
  }
})

test('orfaoVivo: pid inválido é falso', () => {
  assert.equal(orfaoVivo({ pid: -1, inicio: Date.now() }), false)
  assert.equal(orfaoVivo({ pid: 1.5, inicio: Date.now() }), false)
  assert.equal(orfaoVivo({ pid: 10, inicio: Number.NaN }), false)
})

test('orfaoVivo: lançador morto com processo lançado por ele vivo (Windows)', { skip: process.platform !== 'win32' }, () => {
  const inicio = Date.now()
  const a = spawnSync(process.execPath, ['-e', `const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{detached:true,stdio:'ignore'});c.unref();process.stdout.write(String(c.pid))`], { encoding: 'utf8' })
  const b = Number(a.stdout)
  try {
    assert.ok(b > 0)
    const pai = a.pid
    assert.equal(orfaoVivo({ pid: pai, inicio }), true)
    assert.equal(orfaoVivo({ pid: pai, inicio: inicio + 120_000 }), false)
  } finally {
    try { process.kill(b) } catch { /* já saiu */ }
  }
})

test('orfaoVivo: morto com a janela fechada fica guardado sem prazo (Windows)', { skip: process.platform !== 'win32' }, (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const f = { pid: pidMorto(), inicio: Date.now() - 120_000 }
  assert.equal(orfaoVivo(f), false)
  t.mock.timers.tick(60_000)
  const antes = performance.now()
  assert.equal(orfaoVivo(f), false)
  assert.ok(performance.now() - antes < 100, 'a segunda leitura não roda o PowerShell')
})

test('listarTestes: a fila real da trava e do registro de espera vai na linha; ausente vira null', () => {
  const p = paths(tmp())
  ocupar(p.fila, 'proj-x', 1, process.pid, { inicio: 1 })
  mkdirSync(join(p.espera, String(process.pid + 1)), { recursive: true })
  writeFileSync(join(p.espera, String(process.pid + 1), 'info.json'), JSON.stringify({ pid: process.pid + 1, inicio: 2, recurso: 'geral', fila: '_teto' }))
  mkdirSync(join(p.espera, String(process.pid + 2)), { recursive: true })
  writeFileSync(join(p.espera, String(process.pid + 2), 'info.json'), JSON.stringify({ pid: process.pid + 2, inicio: 3, recurso: 'geral' }))
  assert.deepEqual(listarTestes(p, () => true).map((t) => t.fila), ['proj-x', '_teto', null])
})

test('quem espera enxerga o teto novo da config: teto 1 → 2 durante a espera libera a vaga', async () => {
  const p = paths(tmp())
  ocupar(p.fila, '_teto', 1, process.pid)
  let atual = cfg({ modo: 'global', teto: 1, esperaMaxS: 30 })
  const r = relogio(() => { atual = cfg({ modo: 'global', teto: 2, esperaMaxS: 30 }) })
  const code = await rodarNaFila({ dir: tmp(), comando: sai(0), config: atual, p, env: {}, lerConfig: () => atual, ...r })
  assert.equal(code, 0)
})

test('config ilegível durante a espera mantém os últimos valores', async () => {
  const p = paths(tmp())
  ocupar(p.fila, '_teto', 1, process.pid)
  const r = relogio()
  const code = await rodarNaFila({ dir: tmp(), comando: sai(0), config: cfg({ modo: 'global', teto: 1, esperaMaxS: 2 }), p, env: {}, lerConfig: () => { throw new Error('ilegível') }, ...r })
  assert.equal(code, 75)
})
