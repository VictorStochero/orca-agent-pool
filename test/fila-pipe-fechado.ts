// Processo filho do teste de pipe fechado: o teste imprime muito e sai com 3; o stdout deste processo é fechado cedo pelo leitor.

import { rodarNaFila } from '../src/core/fila/rodar.ts'
import { paths } from '../src/core/paths.ts'

const [home, dir] = process.argv.slice(2)
const script =
  "let i=0;const t=setInterval(()=>{for(let k=0;k<2000;k++)console.log('linha '+(i++));if(i>20000){clearInterval(t);process.exitCode=3}},20)"
const code = await rodarNaFila({
  dir,
  comando: [process.execPath, '-e', script],
  config: { modo: 'global', vagas: 1, vagasPorProjeto: 1, teto: 3, processos: 8, esperaMaxS: 30 },
  p: paths(home),
  env: process.env,
})
process.exit(code)
