// Processo filho dos testes de concorrência: roda um comando pela fila e sai com o código dele.

import { rodarNaFila } from '../src/core/fila/rodar.ts'
import { paths } from '../src/core/paths.ts'

const [home, dir, log] = process.argv.slice(2)
const script =
  "const f=require('fs');f.appendFileSync(process.env.LOG,'in\\n');setTimeout(()=>f.appendFileSync(process.env.LOG,'out\\n'),400)"
const code = await rodarNaFila({
  dir,
  comando: [process.execPath, '-e', script],
  config: { modo: 'global', vagas: 1, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 30 },
  p: paths(home),
  env: { ...process.env, LOG: log },
})
process.exit(code)
