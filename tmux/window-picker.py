#!/usr/bin/env python3
"""Find a tmux pane by session, directory or process."""

import os
import shlex
import shutil
import subprocess
import sys


PANE_FORMAT = "\t".join([
    "#{session_id}:#{window_id}.#{pane_id}",
    "#{pane_id}",
    "#{session_name}",
    "#{window_index}.#{pane_index}",
    "#{pane_current_path}",
    "#{E:@window-process}",
])


def pane_rows(output):
    """Keep stable targets hidden while sorting by session, path and pane."""
    rows = []
    for line in output.splitlines():
        fields = line.split("\t")
        if len(fields) != 6:
            continue
        rows.append(fields)
    rows.sort(key=lambda row: (row[2].casefold(), row[4].casefold(), row[3]))
    return ["\t".join(row) for row in rows]


def main():
    socket = os.environ.get("TMUX_PICKER_SOCKET")
    client = os.environ.get("TMUX_PICKER_CLIENT")
    if not socket or not client:
        print("Open this picker with tmux Prefix+w.", file=sys.stderr)
        return 1
    tmux = ["tmux", "-S", socket]
    if not shutil.which("fzf"):
        subprocess.run(tmux + ["display-message", "-c", client, "fzf not found; use Prefix+W."], check=False)
        return 1

    result = subprocess.run(
        tmux + ["list-panes", "-a", "-F", PANE_FORMAT],
        check=True, capture_output=True, text=True,
    )
    rows = pane_rows(result.stdout)
    if not rows:
        return 0
    preview = shlex.join(tmux) + " capture-pane -e -p -t {2}"
    env = os.environ.copy()
    # User-wide fzf bindings/layouts must not change the picker output protocol.
    env.pop("FZF_DEFAULT_OPTS", None)
    env.pop("FZF_DEFAULT_OPTS_FILE", None)
    selected = subprocess.run([
        "fzf", "--delimiter=\t", "--with-nth=3..",
        "--no-multi", "--layout=reverse", "--border=none",
        "--prompt=Directory > ",
        "--header=SESSION  WINDOW.PANE  PATH  PROCESS | Enter: switch | Ctrl-/: preview | Esc: cancel",
        "--preview=" + preview, "--preview-window=down,60%,border-top",
        "--bind=ctrl-/:toggle-preview", "--tabstop=4",
    ], input="\n".join(rows) + "\n", capture_output=True, text=True, env=env)
    if selected.returncode in (1, 130):
        return 0
    if selected.returncode:
        print(selected.stderr, file=sys.stderr, end="")
        return selected.returncode
    row = selected.stdout.rstrip("\n")
    if row not in rows:
        return 1
    target = row.split("\t", 1)[0]
    # Explicit session preserves the chosen session even for linked windows.
    return subprocess.run(
        tmux + ["switch-client", "-c", client, "-t", target], check=False,
    ).returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"tmux picker: {error}", file=sys.stderr)
        sys.exit(1)
