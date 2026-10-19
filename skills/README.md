# Public skills

| Skill | Purpose | Requirements |
|---|---|---|
| `find-docs` | Current library documentation via Context7 | Node.js/npm, network |
| `resolve-command` | Diagnose missing commands | Shell; local-only guidance |
| `tmux` | Isolated interactive terminals | tmux, Bash |
| `web-browser` | Chrome/Chromium CDP automation | Chrome/Chromium, Node.js/npm |

Install browser helper dependencies explicitly:

```sh
cd skills/web-browser/scripts
npm ci --ignore-scripts
```

Configure your agent to load the individual skill directories. They are not
linked automatically, so installing dotfiles does not change your agent's skills.
Each third-party skill includes its source and license notices.

Keep browser profiles, cookies, console/network logs and credentials outside Git.
Use a fresh browser profile; `--profile` copies personal browser state and should
be used only with explicit consent. Review the scripts before running them.

The diagram skill is not included: redistribution terms for its bundled shape
assets need separate review. No binary-data exceptions have been added to the exporter.
