---
name: resolve-command
description: Diagnose a missing shell command by checking PATH and installed tool locations before suggesting installation.
disable-model-invocation: true
---

# Resolve a missing command

1. Check `command -v <command>` and inspect the current PATH.
2. Read relevant shell configuration for tool locations; do not execute an entire
   profile merely to discover PATH, since it can have unrelated side effects.
3. Check existing standard locations:

   | Tool | Location |
   |---|---|
   | Homebrew | `/opt/homebrew/bin`, `/usr/local/bin` |
   | User executables | `~/.local/bin` |
   | Cargo | `~/.cargo/bin` |
   | Bun | `~/.bun/bin` |
   | NVM | `~/.nvm/nvm.sh` |
   | SDKMAN | `~/.sdkman/bin/sdkman-init.sh` |

4. Prepend only confirmed directories for the current command, or source the
   specific trusted tool initializer. For example:

   ```sh
   PATH="$HOME/.local/bin:$PATH" command -v uv
   ```

5. Retry the original command. If it remains unavailable, explain which locations
   were checked and ask before installing anything.

Do not edit profiles, guess organization-specific paths, or print credentials.
Permission errors and invalid arguments are not PATH problems.
