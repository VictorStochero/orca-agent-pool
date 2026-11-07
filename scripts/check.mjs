// `orca plugin check` runs the real worker unsandboxed, which writes the configuration and measures quotas
// in the user's home; run it against a throwaway home instead.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const casa = mkdtempSync(join(tmpdir(), 'agent-pool-check-'))
const env = { ...process.env, HOME: casa, USERPROFILE: casa }
delete env.HOMEDRIVE
delete env.HOMEPATH
try {
  const r = spawnSync('orca', ['plugin', 'check', '.', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  })
  if (r.error) console.error(r.error.message) // ex.: ENOENT quando o `orca` não está no PATH
  process.exitCode = r.status ?? 1
} finally {
  rmSync(casa, { recursive: true, force: true })
}
