import { writeFileSync } from 'node:fs'
import { executar } from '../src/cli/executar.ts'

const [home, pronto] = process.argv.slice(2)
writeFileSync(pronto, 'pronto')
process.exitCode = await executar(['config', 'set', 'fila.vagas=7'], {
  home, env: { LANG: 'en' }, cwd: home, agora: Date.now, fetch,
  orca: { run: async () => { throw new Error('Orca não é necessário') } },
  stdin: async () => '', out: () => {}, err: () => {}
})
