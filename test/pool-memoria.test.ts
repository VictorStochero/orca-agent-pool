import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ramLivreGb } from '../src/core/pool/memoria.ts'
import type { OrcaCli } from '../src/core/tipos.ts'

const orca = (code: number, stdout: string): OrcaCli => ({ run: async () => ({ code, stdout, stderr: '' }) })
const json = (v: unknown) => JSON.stringify({ ok: true, result: { host: { availableMemory: v } } })

describe('ramLivreGb', () => {
  it('converte bytes em GB', async () => assert.equal(await ramLivreGb(orca(0, json(4 * 1073741824))), 4))
  it('leitura inconclusiva devolve null', async () => {
    assert.equal(await ramLivreGb(orca(1, json(1))), null)
    assert.equal(await ramLivreGb(orca(0, 'não json')), null)
    assert.equal(await ramLivreGb(orca(0, json('x'))), null)
    assert.equal(await ramLivreGb(orca(0, json(-1))), null)
    assert.equal(await ramLivreGb(orca(0, JSON.stringify({ ok: false }))), null)
  })
})
