# Personal Pi extensions

Selected extensions live in `pi/extensions/`; the allowlist is `pi/extensions.json`.
Public exports include only reviewed source files and a lockfile with public npm
URLs. Package versions, integrity hashes and the dependency graph are unchanged.
The working installation and its existing dependencies are not modified by export.

These extensions execute with Pi's permissions. Review them before enabling them.
Third-party sources and licenses are listed in `NOTICE.md` in the public snapshot.

```sh
make -C setup/pi adopt   # one-time migration, with backups
make -C setup/pi config  # create missing links; never replace existing entries
make -C setup/pi check   # verify links
```

Migration copies only source, manifests and tests, moves originals under
`~/.pi/agent/extension-backups/<timestamp>/`, then replaces each selected entry
under `~/.pi/agent/extensions/` with a symlink. Unselected entries stay untouched.
`PI_CODING_AGENT_DIR` overrides the agent directory.

Runtime `.pi`, caches, logs and `node_modules` are not tracked. Existing `pi-fzf`
dependencies are reused via an ignored `node_modules` symlink into the backup.
**Keep the backup while that link is in use.** `make -C setup/pi deps` explicitly
reinstalls dependencies (network access); install Pi itself separately first.

No settings, models, authentication files or session histories are migrated.
No `/reload` is issued during migration. Reload Pi when ready.
The model-alias and `tps-time` extensions remain outside this manifest.

The `speed-shortcut` extension expects an existing `/speed` command and
`service-tier` session state from your Pi environment; this collection does not
provide that implementation. Omit it from `extensions.json` when unavailable.
Other optional tools include tmux (subagent), git (files/review), and gh for
GitHub review operations. Session, notification and todo data remain local.

To undo adoption, stop/reload Pi as appropriate, remove only the managed symlinks
under the agent extensions directory, and move the corresponding backup entries
back. The backup's `adoption.json` lists exactly which entries were migrated.
