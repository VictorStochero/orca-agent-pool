# Agent Pool & Test Queue for Orca

[![ci](https://github.com/VictorStochero/orca-agent-pool/actions/workflows/ci.yml/badge.svg)](https://github.com/VictorStochero/orca-agent-pool/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-blue)
![orca](https://img.shields.io/badge/Orca-%E2%89%A5%201.4.246-black)

An [Orca](https://github.com/stablyai/orca) plugin that lets many coding agents share one machine safely. It gives you an **agent pool** (which account should do the next task, with slots per account), a **test queue** for any language (so parallel agents don't overload the machine or corrupt each other's test databases) and a **panel** in Orca to watch and configure both.

![Agent Pool panel](assets/panel.png)

## Contents
- [Features](#features) · [Requirements](#requirements) · [Install](#install) · [How agents use it](#how-agents-use-it)
- [The panel](#the-panel) · [The test queue](#the-test-queue) · [Configuration](#configuration)
- [What it changes on your machine](#what-it-changes-on-your-machine) · [Quota and privacy](#quota-and-privacy)
- [CLI](#cli) · [Troubleshooting](#troubleshooting) · [Uninstall](#uninstall) · [Development](#development) · [Changelog](#changelog)

## Features
- **Agent pool**: your agent accounts (Claude Code, Codex, OpenCode, Antigravity, …) with **slots**, **weight** and **roles**. The writer for each task is the account with the most quota left × its weight, or the first one in your order. Quota follows the separate limit of the model the account uses (for example Fable, or Antigravity's Gemini groups), and `writer`/`second` print the model to pass as `--model`. Accounts Orca already knows join automatically; extra CLIs, such as a second Claude login in its own `CLAUDE_CONFIG_DIR`, are added by hand.
- **Test queue**: every test run waits for its turn, per machine and per shared resource, for Laravel (artisan/Pest), Python (pytest), JavaScript/TypeScript (vitest, jest, npm/pnpm/yarn/bun), Go, Rust, .NET and RSpec.
- **Hooks**: an optional hook for Claude Code and Codex that turns away a bare test command and tells the agent the queued form, and turns away `orca orchestration worker-start` without a pending `res-` slot reservation, so the rules hold even when an agent forgets them.
- **Panel**: tests waiting and running, the pool with quotas, alerts (for example an account that must log in again) and every setting, in English or Portuguese following Orca's language.
- Works with Orca's native orchestration (`orca orchestration worker-start`, `send`, `worker_done`).

## Requirements
- Orca **1.4.246** or newer. The plugin's CLI runs on Orca's own runtime: no separate Node.js, Python or Git Bash.
- Windows, macOS or Linux.

## Install
1. In Orca, open **Settings → Plugins** and install **Agent Pool & Test Queue** from the catalog.
   Not listed yet? Choose **Add plugin → From a Git URL…** and paste `https://github.com/VictorStochero/orca-agent-pool#v1.0.10`.
2. Approve the access it asks for (a trusted worker and its own storage).
3. Open the **Agent Pool** panel. On first activation the plugin:
   1. creates `~/.agents/agent-pool/` (`config.json` and `state/`);
   2. writes the launcher `~/.agents/bin/agent-pool` (plus `agent-pool.cmd` on Windows);
   3. installs the `agent-pool` skill into `~/.agents/skills/agent-pool` and links it into each detected agent's skills folder (a copy you edited is never overwritten);
   4. installs the agent hooks (see [below](#what-it-changes-on-your-machine)).

The panel stays on a **Requirements** screen until all of this is in place, including Orca's own `orchestration` skill, which it can install for you. Agents always call the launcher by its full path; add `~/.agents/bin` to your `PATH` if you want the short name `agent-pool` in your own terminal.

## How agents use it
The `agent-pool` skill teaches this to the agents; this is what a coordinator does around each worker:

```sh
# 1. pick the writer and reserve its slot (exit 75 = pool full: wait and try again)
~/.agents/bin/agent-pool writer --reserve task-42
#    → claude-b (pace 15.6 · 33% free, resets in 18h) · weight 5 · reserve res-task-42

# 2. start the worker on that account, then hand the slot to the real dispatch
orca orchestration worker-start ...
~/.agents/bin/agent-pool slot swap res-task-42 <dispatch-id>

# 3. inside the worker, every test goes through the queue
~/.agents/bin/agent-pool test -- php artisan test --filter=Orders

# 4. when the worker is done
~/.agents/bin/agent-pool slot release <dispatch-id>
```

A reservation that is never swapped expires after 10 minutes, and a slot whose dispatch Orca reports as finished is freed on the next read. With the hooks installed, a bare `php artisan test` is refused with the exact command to run instead.

## The panel
| Settings · Accounts | Settings · Hooks |
|---|---|
| ![Accounts settings](assets/settings-accounts.png) | ![Hooks settings](assets/settings-enforcement.png) |

- **Tests in the queue**: what is running and waiting, per queue, with the process and how long it has waited.
- **Agent pool**: slots in use per account (`2/∞` for an account without its own limit), open Claude sessions per account (including the ones you open yourself; a session without `--agent` is display only, while an agent session opened with `--agent <role>` takes a slot for as long as it stays open), 5-hour and weekly quota, and the details of each account on click.
- **Settings**: tabs for the queue, the pool, the accounts (**Configure** an account or **Add** a custom one), **Hooks** (install, reinstall or remove the hook per agent), **Installation** (the requirements table with each item's detail, always visible, plus **Check now** to read them again on demand) and the panel itself.

## The test queue
Run tests with `agent-pool test` (detects the runner) or `agent-pool test -- <command>`.

| Mode | Behaviour |
|---|---|
| **Per database** (default) | one queue per shared resource. A database (`host:port/name`) gets one slot, so tests on the same database wait for each other and different databases run in parallel. The general queue and container runners use `fila.vagas` slots. |
| **Global** | one queue for the whole machine |
| **Per project** | one queue per project (`fila.vagas_projeto` slots each) |

The machine-wide cap (`fila.teto`) applies in every mode. A new mode applies to tests started afterwards (a test that already has a slot keeps its queue until it ends); new slot counts and cap also apply to tests already waiting. The resource comes, in order, from the project's `.orca/agent-pool.json` (`{"recurso": "postgres:5433"}`), `DATABASE_URL`, `DB_HOST`/`DB_PORT`/`DB_DATABASE` (also when set inline, as in `DB_DATABASE=x php artisan test`), a container runner, or falls back to the general queue.

| Detected by | Runner | Parallelism (`fila.processos`) |
|---|---|---|
| `artisan` | `php artisan test` | `--parallel --processes=N` |
| `pyproject.toml` / `pytest.ini` / `requirements*.txt` | `pytest` (uv, poetry, pipenv or .venv) | `-n N` when pytest-xdist is installed |
| `package.json` | the `test` script (pnpm, yarn, bun or npm) | `--maxWorkers=N` |
| `go.mod` | `go test ./...` | `-p N` |
| `Cargo.toml` | `cargo test` | `-- --test-threads=N` |
| `*.csproj` / `*.sln` | `dotnet test` | `-m:N` |
| `Gemfile` + `spec/` | `rspec` | — |

With an explicit command (`agent-pool test -- <command>`) `fila.processos` is a cap on the parallelism flags the agent passed: `--processes=N` (with `--parallel` on a Laravel/Pest/ParaTest command; `--parallel` alone gets `--processes=<cap>`), pytest-xdist `-n N` / `--numprocesses N` and `--maxWorkers=N` are lowered to the cap and the queue says so on stderr. A symbolic value (`auto`, `logical`, `25%`) becomes the number of cores it stands for, limited by the cap. A smaller request is left as it came. `go -p`, `cargo --test-threads` and `dotnet -m:` are not capped.

After a parallel Laravel run the queue drops the `<database>_test_N` copies it created.

## Configuration
Everything is editable in the panel; the same keys work with `agent-pool config set key=value [key=value …]` (validated, all or nothing). Key names and values keep the plugin's original Portuguese names.

| Key | Values (default) | Meaning |
|---|---|---|
| `fila.modo` | `banco` (per database) · `global` · `projeto` | queue mode |
| `fila.vagas` | 1–99 (2) | slots per queue (general queue in `banco` mode) |
| `fila.vagas_projeto` | 1–99 (1) | slots per project in `projeto` mode |
| `fila.teto` | 1–99 (3) | tests at once on the machine |
| `fila.processos` | 1–64 (8) | parallel processes passed to the runner; also a cap on the parallelism flags an agent passes itself |
| `pool.teto` | 0–99 (0 = no cap) | workers at once on the machine |
| `pool.ram_min` | GB (0 = off) | free memory needed to reserve a new slot |
| `pool.escolha` | `ritmo` (quota pace × weight) · `ordem` (your order) | how the writer is picked |
| `pool.ordem` | account names, comma separated | the order used by `ordem` |
| `conta.<name>.vagas` | 0–99 (0 = no own limit) | slots of the account |
| `conta.<name>.peso` | 1–100 | weight in the writer choice |
| `conta.<name>.papeis` | `escritor`, `revisor`, `verificador`, `mecanico`, `segunda-opiniao`, `orquestra` | roles (writer, reviewer, verifier, mechanical, second opinion, coordinator) |
| `conta.<name>.ativo` | `sim` · `nao` | `nao` keeps the account listed and measured but gives it no new work |
| `conta.<name>.config` / `.comando` | a config folder (e.g. `~/.claude-work`) / a command | how the account's CLI is opened |
| `conta.<name>.modelo` | a model id (e.g. `gemini-3.8-flash-high`), empty = the agent default | the `--model` the pool tells the coordinator to use; the account's quota follows the separate limit of that model (Fable on Claude; Gemini 4 Argon, Gemini Models or Claude and GPT models on Antigravity, which defaults to Flash) |
| `conta.<name>.adicionar` / `.remover` | agent id or `auto` / `1` | add a custom account / remove one |

## What it changes on your machine
The plugin runs as a **trusted worker** (Node.js with your user's access) and uses the plugin's own storage (`storage:own`). It writes only:

| Where | What | How to undo |
|---|---|---|
| `~/.agents/agent-pool/` | configuration, locks, waiting list, quota cache, backups | delete the folder |
| `~/.agents/bin/agent-pool[.cmd]` | the launcher | delete the file |
| `~/.agents/skills/agent-pool` + links | the skill | delete the folder and links |
| Claude Code `settings.json` (`hooks.PreToolUse`, matcher `Bash\|PowerShell`) in `~/.claude` and in the config folder of each Claude account of the pool | one hook that sends test commands through the queue and refuses `orca orchestration worker-start` without a pending `res-` slot reservation | Settings → Hooks → Remove |
| Codex `~/.codex/hooks.json` + hook trust in `~/.codex/config.toml` | the same hook for Codex | Settings → Hooks → Remove |

Before the first write to an agent's config file the original is backed up to `~/.agents/agent-pool/state/backup/`. Our hook is recognized by its command (the launcher path followed by `hook claude` or `hook codex`); removing it leaves the rest of the file as it was. Files that are symbolic links stay links: the plugin writes to the link's target.

## Quota and privacy
- Accounts Orca manages use Orca's native quota (`orca account list`).
- Custom Claude accounts are measured with the account's own credentials file (`<CLAUDE_CONFIG_DIR>/.credentials.json`) against Anthropic's usage endpoint, falling back to `claude /usage`. The token is sent **only** to `api.anthropic.com`; it is never printed, logged or written anywhere.
- An account that is logged out shows **needs login** with the command to fix it, and is not picked for work.
- No telemetry: the plugin talks only to Orca, the agent CLIs and that usage endpoint.

## CLI
```
agent-pool test [-- command]                  run a test through the queue
agent-pool writer [--reserve <tag>]           pick the writer (and reserve its slot)
agent-pool second --family <family>           pick a second-opinion account of another model family
agent-pool slot take <account> <owner>        reserve a slot by hand
agent-pool slot swap <provisional> <dispatch> hand a reservation to the real dispatch
agent-pool slot release <dispatch> | free     free a slot | list free slots
agent-pool status [--json]                    queue and pool at a glance
agent-pool config get | set key=value …       read or change the configuration
agent-pool measure [account]                  measure quotas now
agent-pool doctor                             check config, Orca, launcher, skill and hooks
agent-pool hook <claude|codex>                the agent hook (called by the agents)
```
Exit codes: `0` ok, `2` invalid usage, `75` no slot or the wait ran out (try again).

## Troubleshooting
| Symptom | What to do |
|---|---|
| Something looks wrong | run `~/.agents/bin/agent-pool doctor`: every line should say `ok` |
| An agent says `agent-pool: command not found` | agents must call `~/.agents/bin/agent-pool` by its full path (the skill and the hook already do) |
| `exit 75` / "queue busy" | another test holds the slot of that resource, or the pool is full: wait and run again |
| An account shows **needs login** | log in with that account's CLI (the panel shows the command) |
| An account shows **not set up on this machine** | its CLI is not installed (e.g. `codex` not in the PATH) or its own folder (e.g. `~/.claude-team`) does not exist. It raises no alert and is left out of the writer and second-opinion choice; it comes back by itself once the CLI or the folder appears. Remove it in **Settings → Accounts** if you will not use it |
| The panel is stuck on **Requirements** | install what it lists (it can install the skill and the hooks for you) |
| A test was refused by the hook | run the command the hook printed: `"…/agent-pool" test -- <your command>` |
| `orca orchestration worker-start` was refused by the hook | reserve a slot first, with `"…/agent-pool" writer --reserve <tag>` or `"…/agent-pool" slot take <account> res-<tag>` in a previous command, or before `worker-start` in the same `&&` chain without a pipe; after the receipt, `slot swap res-<tag> <dispatch>` |
| A test is shown as **stopped** | its process ended without freeing the slot; the next panel collection or test start reclaims dead locks in every queue and the machine-wide cap; a live orphan on Windows keeps its slot |

## Uninstall
1. In the panel: **Settings → Hooks → Remove** for each agent (this takes our hook out of the agents' config files).
2. In Orca: remove **Agent Pool & Test Queue** in **Settings → Plugins**.
3. Optionally delete `~/.agents/agent-pool/`, `~/.agents/bin/agent-pool*` and `~/.agents/skills/agent-pool` (plus its links in the agents' `skills` folders).

## Development
```sh
npm install
npm run typecheck
npm test               # core and CLI (node:test)
orca plugin test .     # worker and panel
npm run check          # orca plugin check against a throwaway home
orca plugin dev load . # load this folder into Orca (the real install)
```
- Never run `orca plugin check` bare: it starts the real worker, which writes the hooks, launcher and skill into your real home. `npm run check` runs it against a temporary home.
- `orca plugin dev load` and `dev watch` are a real install: the launcher points at this folder. Before deleting the folder, use **Remove** in Settings → Hooks (or install the plugin from the catalog), or the agents' hook will call a launcher that no longer exists.
- Tests isolate `HOME` and `USERPROFILE`, and a guard fails the suite if it touches your real home.

## Changelog
- **1.0.10**: `agent-pool status` and the panel show the test command the queue launches, with the `fila.processos` cap already applied, instead of the one the agent asked for; a waiting test follows a new `fila.processos` at once, with or without an explicit command (the detected runner used to keep the value from when it started waiting, and launched with it), and a running one shows what was really launched.
- **1.0.9**: the queue clears the locks and waits of dead tests on its own (at every test start and every panel refresh), the machine cap included, so a killed agent no longer leaves a test "stopped"; the hook lets `orca orchestration worker-start` through on a reservation in the same command only when it is chained with `&&` (no pipe, no `;`), and backticks no longer hide a test or a `worker-start`; `fila.processos` caps `--processes` only for Laravel/Pest/ParaTest (a `--parallel` of other tools stays as written), and `auto` or a percentage resolves by the CPU count, never above the cap; the agent-pool skill is also linked for Antigravity (`~/.gemini/config/skills`).
- **1.0.8**: an agent session opened with `--agent <role>` takes a slot of its account for as long as it stays open (on Windows only when the process matches the session's start time), and a pending `res-` reservation adds to it; the panel lists the live agents under Slots in use; the hook refuses `orca orchestration worker-start` (also `orca-ide` and `orca-dev`) without a pending reservation, unless the same command reserves first; `fila.processos` caps the parallel flags of an explicit test command (`--processes`, `-n`, `--maxWorkers`) and adds `--processes` to a bare `--parallel`.
- **1.0.7**: an optional **Model** per account, passed as `--model` by `writer` and `second`; the pool follows the separate limit of that model (Fable; Antigravity's Gemini Models, Claude and GPT models or Gemini 4 Argon), and Antigravity defaults to Gemini 3.8 Flash so a second opinion no longer burns the Argon limit; account details are readable in a narrow panel; an account whose CLI or own folder does not exist on the machine shows as "not set up on this machine" instead of raising a login alert; the requirements screen stays (with the error) when an install fails, and a notice confirms when everything is installed; the Enforcement settings are now called Hooks; a new Installation tab in Settings lists the requirements and checks them again on demand.
- **1.0.6**: a test whose `agent-pool test` was killed (for example by an Orca update on Windows) keeps its slot and shows as running while the test itself still runs; the pool shows open Claude sessions per account and their total; tables fit a narrow panel without horizontal scrolling; a long cell no longer hides the whole table; the queue mode radio selects one option; the Queue column shows each test's real queue; waiting tests pick up new slot and cap settings; the queue no longer fails with `ENOTEMPTY` when Windows holds a file in a lock folder.
- **1.0.5**: an account's details list its separate limits: per-model weekly limits of Claude accounts (such as Fable) and the quota groups Orca reports for an agent (such as Antigravity's Gemini, Claude/GPT and Gemini 4 Argon).
- **1.0.4**: the panel no longer shows a false "Orca unavailable" and empty quotas when Orca restarts the idle worker (it shows the recorded quotas and "checking" until the first collection); a Claude account with an expired token is no longer reported as "usage unavailable" when `claude /usage` is slow (45 s timeout, then the usage endpoint with the renewed token).
- **1.0.3**: README with screenshots, usage flow, configuration reference, troubleshooting and uninstall.
- **1.0.2** (not published): version numbers aligned in every manifest (the `v1.0.1` tag shipped manifests still saying 1.0.0).
- **1.0.1**: Enforcement moved into Settings; Settings drawn as a card like the other sections.
- **1.0.0**: first release.

## License
[MIT](LICENSE)

---

## Português

Plugin do Orca que deixa vários agentes de código dividirem uma máquina com segurança: **pool de agentes** (contas com vagas, peso e papéis; o escritor de cada tarefa é a conta com mais cota sobrando × peso, ou a primeira da sua ordem), **fila de testes** para qualquer linguagem (por máquina e por recurso disputado, como o mesmo banco de testes), **hooks** opcionais no Claude Code e no Codex, e um **painel** no Orca, em português ou inglês conforme o idioma do Orca, com tudo configurável.

**Instalação:** pelo catálogo de plugins do Orca (Configurações → Plugins) ou por **Add plugin → From a Git URL…** com `https://github.com/VictorStochero/orca-agent-pool#v1.0.10`; aprove o acesso e abra o painel **Agent Pool**. O plugin grava só em `~/.agents/` (configuração, lançador `~/.agents/bin/agent-pool` e a skill) e instala o hook no Claude Code e no Codex, com backup antes e remoção em Configurações → Hooks.

**Uso pelos agentes:** `~/.agents/bin/agent-pool writer --reserve <tag>` antes do `worker-start`, `slot swap` para o dispatch real, `agent-pool test -- <comando>` para todo teste e `slot release` no fim. Contas Claude personalizadas são medidas com a credencial da própria conta, enviada só à API da Anthropic e nunca gravada ou exibida. Problemas: `~/.agents/bin/agent-pool doctor`. Os detalhes de modos da fila, executores, configuração e comandos estão nas seções em inglês acima.
