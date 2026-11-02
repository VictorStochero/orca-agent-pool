# Agent Pool & Test Queue for Orca

An [Orca](https://github.com/stablyai/orca) plugin that lets many coding agents share one machine safely:

- **Agent pool** — your agent accounts (Claude Code, Codex, OpenCode, Antigravity, …) with slots, weights and roles. The writer for each task is the account with the most quota left × its weight (or the first in your order). Accounts Orca already knows are added automatically; custom CLIs (for example a second Claude login in its own `CLAUDE_CONFIG_DIR`) are added by hand.
- **Test queue** — every test run waits for its turn, per machine and per shared resource, for **any language**: Laravel (artisan/Pest), Python (pytest), JavaScript/TypeScript (vitest, jest, npm/pnpm/yarn/bun), Go, Rust, .NET and RSpec.
- **Panel** — a sidebar panel (English and Portuguese, following Orca's language) that shows tests waiting and running, the pool with quotas, connection alerts (for example an account that needs to log in again), and every setting.

It works with Orca's native orchestration (`orca orchestration worker-start`, `send`, `worker_done`): agents reserve a slot before starting a worker and run tests through the queue.

## Requirements
- Orca 1.4.246 or newer (the plugin's CLI runs on Orca's own runtime; no separate Node.js, Python or Git Bash needed).
- Windows, macOS or Linux.

## Install
Install **Agent Pool & Test Queue** from Orca's plugin catalog (Settings → Plugins) and approve the access it asks for. On activation the plugin:

1. creates `~/.agents/agent-pool/` (`config.json` and `state/`);
2. writes the launcher `~/.agents/bin/agent-pool` (and `agent-pool.cmd` on Windows). Agents call it by that full path; add `~/.agents/bin` to your `PATH` if you want the short name `agent-pool` in your own terminal;
3. installs the `agent-pool` skill into `~/.agents/skills/agent-pool` and links it into each detected agent's skills folder (a copy you edited is never overwritten);
4. installs the enforcement hooks (below).

The panel stays locked on a "Requirements" screen until all of this is in place, including Orca's own `orchestration` skill (it can install it for you).

## What it changes on your machine
The plugin runs as a **trusted worker** (Node.js with your user's access) and uses the plugin's own storage (`storage:own`). It writes only:

| Where | What | How to undo |
|---|---|---|
| `~/.agents/agent-pool/` | configuration, locks, waiting list, quota cache, backups | delete the folder |
| `~/.agents/bin/agent-pool[.cmd]` | the launcher | delete the file |
| `~/.agents/skills/agent-pool` + links | the skill | delete the folder and links |
| Claude Code `settings.json` (`hooks.PreToolUse`, matcher `Bash\|PowerShell`) in `~/.claude` and in the config folder of each Claude account of the pool | one hook that sends test commands through the queue | panel → Enforcement → Remove |
| Codex `~/.codex/hooks.json` + hook trust in `~/.codex/config.toml` | the same hook for Codex | panel → Enforcement → Remove |

Before the first write to an agent's config file the original is backed up to `~/.agents/agent-pool/state/backup/`. Our hook is recognized by its command (the launcher path followed by `hook claude` or `hook codex`); removing it leaves the rest of the file with the same content (the original stays in `state/backup`). Files that are symbolic links keep being links: the plugin writes to the link's target.

## Quota and privacy
- Accounts Orca manages use Orca's native quota (`orca account list`).
- Custom Claude accounts are measured with the account's own credentials file (`<CLAUDE_CONFIG_DIR>/.credentials.json`) against Anthropic's usage endpoint. The token is sent **only** to `api.anthropic.com`; it is never printed, logged or written anywhere. An account that is logged out shows "needs login" with the command to fix it, and is not picked for work.

## The test queue
Run tests with `agent-pool test` (detects the runner) or `agent-pool test -- <command>`.

| Mode | Behaviour |
|---|---|
| **Global** | one queue for the whole machine |
| **Per database** (default) | one queue per shared resource: one slot per database (`host:port/name`): tests that use the same database wait for each other; different databases run in parallel; the general queue and container runners keep `fila.vagas` slots |
| **Per project** | one queue per project |

The machine-wide limit applies in every mode. The resource is read, in order, from the project's `.orca/agent-pool.json` (`{"recurso": "postgres:5433"}`), `DATABASE_URL`, `DB_HOST`/`DB_PORT`, a container runner, or falls back to a general queue.

| Detected by | Runner | Parallelism ("processes") |
|---|---|---|
| `artisan` | `php artisan test` | `--parallel --processes=N` |
| `pyproject.toml` / `pytest.ini` / `requirements*.txt` | `pytest` (uv, poetry, pipenv or .venv) | `-n N` when pytest-xdist is installed |
| `package.json` | the `test` script (pnpm, yarn, bun or npm) | `--maxWorkers=N` |
| `go.mod` | `go test ./...` | `-p N` |
| `Cargo.toml` | `cargo test` | `-- --test-threads=N` |
| `*.csproj` / `*.sln` | `dotnet test` | `-m:N` |
| `Gemfile` + `spec/` | `rspec` | — |

## CLI
```
agent-pool test [-- command]                 run a test through the queue
agent-pool writer [--reserve <tag>]          pick the writer (and reserve its slot)
agent-pool second --family <family>          pick a second-opinion account
agent-pool slot take <account> <owner> | swap <provisional> <dispatch> | release <dispatch> | free
agent-pool status [--json] · config get|set … · measure [account] · doctor · hook <claude|codex>
```
Exit codes: 0 ok, 2 invalid usage, 75 no slot or the wait ran out (try again).

## Development
```
npm install
npm run typecheck
npm test                 # core and CLI (node:test)
orca plugin test .       # worker and panel
npm run check            # orca plugin check against a throwaway home (never run `orca plugin check` bare: it starts the real worker and writes the hooks, launcher and skill into your real home; to undo, panel → Enforcement → Remove, the originals are in `~/.agents/agent-pool/state/backup`)
orca plugin dev load .   # load this folder into Orca
```
`orca plugin dev load` and `dev watch` are the real install: activating the worker writes the hooks (Claude Code and Codex), the `~/.agents/bin/agent-pool` launcher (pointing at this folder) and the skill into your real home. Before deleting the folder, use "Remove enforcement" in the panel (or reinstall the plugin from the catalog), otherwise every agent hook calls a launcher that no longer exists.

## License
MIT

---

## Português

Plugin do Orca que deixa vários agentes de código dividirem uma máquina com segurança: **pool de agentes** (contas com vagas, peso e papéis; o escritor de cada tarefa é a conta com mais cota sobrando × peso, ou a primeira da sua ordem), **fila de testes** para qualquer linguagem (por máquina e por recurso disputado, como o mesmo banco de testes) e um **painel** no Orca, em português ou inglês conforme o idioma do Orca, com tudo configurável.

Instale **Agent Pool & Test Queue** pelo catálogo de plugins do Orca e aprove o acesso. O plugin grava só em `~/.agents/` (configuração, lançador `~/.agents/bin/agent-pool` e a skill) e instala os hooks de imposição no Claude Code e no Codex, com backup e remoção pelo painel. Contas Claude personalizadas são medidas com a credencial da própria conta, enviada apenas à API da Anthropic e nunca gravada ou exibida. Detalhes de modos da fila, executores e comandos nas seções em inglês acima. Carregar o plugin com `orca plugin dev load` ou `dev watch` é a instalação real: grava hooks, lançador (apontando para a pasta do plugin) e skill na sua casa; antes de apagar a pasta, use "Remover imposição" no painel.
