// Processo filho do teste de concorrência: espera o instante combinado e tenta a reserva.
import { paths } from '../../src/core/paths.ts'
import { pegar } from '../../src/core/pool/vagas.ts'

const [home, config, dono, inicio] = process.argv.slice(2)
while (Date.now() < Number(inicio)) { /* espera ocupada para largar junto */ }
process.stdout.write(pegar(paths(home), JSON.parse(config), 'a', dono))
