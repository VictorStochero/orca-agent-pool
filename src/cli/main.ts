import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { criarOrcaCli } from '../core/orca.ts'
import { executar } from './executar.ts'

// O lançador liga isto só para o Electron rodar como Node; os testes que o CLI dispara não devem herdar.
delete process.env.ELECTRON_RUN_AS_NODE

process.exitCode = await executar(process.argv.slice(2), {
  home: homedir(),
  env: process.env,
  orca: criarOrcaCli(),
  fetch,
  cwd: process.cwd(),
  agora: Date.now,
  stdin: async () => {
    const linhas: string[] = []
    for await (const l of createInterface({ input: process.stdin })) linhas.push(l)
    return linhas.join('\n')
  },
  out: s => process.stdout.write(`${s}\n`),
  err: s => process.stderr.write(`${s}\n`),
})
