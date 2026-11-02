Validate the plugin with `npm run check`; never run `orca plugin check` bare: it starts the worker against your real home (it writes hooks, the launcher and the skill).
Run `npm run typecheck`, `npm test` (core and CLI) and `orca plugin test .` (worker and panel); the tests isolate HOME and USERPROFILE. To wait for a test slot, use `agent-pool test -- <command>`.
