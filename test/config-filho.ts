// Processo filho: atualiza a config pela trava segurando-a por um tempo, para forçar a sobreposição.
import { atualizarConfig } from '../src/core/config.ts'
import { aplicar } from '../src/core/config-chaves.ts'
import { paths } from '../src/core/paths.ts'

const [home, chave, valor] = process.argv.slice(2)
await atualizarConfig(paths(home), c => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
  return aplicar(c, { [chave]: valor })
})
