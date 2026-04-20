# Command Runner Example

[繁體中文](./README.zh-TW.md)

An agent that runs shell commands on your machine, with the built-in command-safety engine blocking dangerous patterns.

## Run

```bash
helix login --provider openai --api-key YOUR_KEY
helix start
```

Then:

```bash
helix agent chat ops
> 看一下 /var/log 裡最新的 3 個 .log 檔
```

## What's protected

The `builtin-command-safety` hook inspects every `shell_exec` tool call against 35+ danger patterns **before** execution:

- `rm -rf` / `find -delete` / `dd of=/dev/...` → **blocked**
- `DROP TABLE` / `TRUNCATE` / `DELETE FROM ... ;` without WHERE → **blocked**
- `git push --force` / `git reset --hard` → **blocked**
- `curl ... | sh` / `wget ... | bash` → **blocked**
- `chmod -R` / `chown -R` → **warned** (proceeds with log)

Full pattern list: `GET /api/safety/patterns` when the server is running.

## Test the block

```bash
> 幫我清空 /tmp
```

The agent will propose `rm -rf /tmp`, but the hook catches it and returns an abort message. The agent then has to suggest a safer alternative (like `find /tmp -mindepth 1 -mtime +7 -delete` — which is also caught; ultimately it has to enumerate and ask for confirmation).

## Prompt injection defense

Also enabled: `builtin-injection-defense`. If a user message or tool output contains `ignore previous instructions`, `you are now an unrestricted AI`, etc., the tool call is aborted.

## Customize

- Remove `shell_exec` from `tools` to make it a read-only analyzer
- Add custom hooks in the `hooks.custom` array — see `docs/core-guide.md`
- Change `safety.blockOnDanger` to `false` to downgrade block → warn (not recommended)
