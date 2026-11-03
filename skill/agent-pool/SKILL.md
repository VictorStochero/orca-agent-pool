---
name: agent-pool
description: Use before starting worker agents or running tests on a machine with the Orca "Agent Pool & Test Queue" plugin — reserve an agent slot (writer chosen by quota) before `orca orchestration worker-start`, release it afterwards, and run every test through the machine-wide test queue with `~/.agents/bin/agent-pool test`.
---

# Agent Pool & Test Queue

This machine shares its agent accounts and its test resources between many agents and worktrees. The launcher installed by the Orca plugin keeps that fair and safe: `~/.agents/bin/agent-pool` (`~/.agents/bin/agent-pool.cmd` on Windows PowerShell). It is not on the PATH: always call it by that path. Below, `agent-pool` stands for that full path.

## Before starting a worker
1. `~/.agents/bin/agent-pool writer --reserve <tag>` — picks the account with the most quota left (times its weight) among those with a free slot and reserves the slot. Prints the account. If the line carries `model <id>`, pass `--model <id>` to `worker-start`. Exit 75: the pool is full; wait for one of your workers to finish, then try again.
2. Start the worker with Orca (`orca orchestration worker-start …`) on that account.
3. `~/.agents/bin/agent-pool slot swap res-<tag> <dispatch_id>` — binds the reservation to the real dispatch.
4. If `worker-start` fails: `~/.agents/bin/agent-pool slot release res-<tag>`.
5. When the worker is done and verified: `~/.agents/bin/agent-pool slot release <dispatch_id>`.

A worker opened with `--agent <role>` keeps its slot taken for as long as its session stays open, even after `slot release`; close it to free the slot. The hook refuses `worker-start` without a pending reservation.

Second opinion from another model family: `~/.agents/bin/agent-pool second --family <claude|gpt|gemini>` (a family other than the writer's). If the line carries `model <id>`, pass `--model <id>` to `worker-start` (Antigravity defaults to Flash so a second opinion does not burn the Argon limit).

## Running tests
Run every test through the queue, never directly:

```
~/.agents/bin/agent-pool test                 # detects the runner (artisan/pest, pytest, vitest/jest/npm, go, cargo, dotnet, rspec)
~/.agents/bin/agent-pool test -- <command>    # runs exactly this command in the queue
```

Exit 75 means the queue stayed busy for too long: run the same command again. The queue limits how many tests run at once on the machine and per shared resource (for example, the same test database), so parallel worktrees do not corrupt each other.

## Seeing and changing the state
- `~/.agents/bin/agent-pool status` (or `--json`): accounts, slots, quotas, tests running and waiting.
- `~/.agents/bin/agent-pool doctor`: checks the launcher, this skill and the agent hooks.
- Configuration is edited in the Orca panel "Agent Pool" (or `~/.agents/bin/agent-pool config get|set`). Do not edit `~/.agents/agent-pool/` by hand.
