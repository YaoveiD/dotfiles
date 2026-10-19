#!/usr/bin/env python3
"""Manage selected personal Pi extensions without touching settings or credentials."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
EXCLUDED = {".pi", ".git", "node_modules", "__pycache__", ".DS_Store", ".cache"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def ignored(name):
    return name in EXCLUDED or name.endswith((".log", ".pyc"))


def names(root):
    entries = json.loads((root / "pi/extensions.json").read_text())["extensions"]
    require(len(entries) == len(set(entries)), "duplicate extension")
    for name in entries:
        require(isinstance(name, str) and name and not name.startswith(".")
                and Path(name).name == name and "\\" not in name,
                "extension names must be plain basenames")
    return entries


def inventory(path):
    require(not path.is_symlink(), f"unexpected symlink: {path}")
    if path.is_file():
        return {".": hashlib.sha256(path.read_bytes()).hexdigest()}
    require(path.is_dir(), f"missing extension: {path}")
    files = {}
    for base, dirs, filenames in os.walk(path):
        dirs[:] = [name for name in dirs if not ignored(name)]
        for name in dirs:
            require(not (Path(base) / name).is_symlink(), f"symlink directory: {name}")
        for name in filenames:
            if ignored(name):
                continue
            file = Path(base) / name
            require(file.is_file() and not file.is_symlink(), f"non-regular source: {file}")
            files[str(file.relative_to(path))] = hashlib.sha256(file.read_bytes()).hexdigest()
    return files


def linked(link, destination):
    return link.is_symlink() and link.resolve() == destination.resolve()


def adopt(root, agent):
    managed = root / "pi/extensions"
    live = agent / "extensions"
    require(live.is_dir() and not live.is_symlink(), "expected a real extensions directory")
    require(not managed.is_symlink(), "managed directory must not be a symlink")
    plan = []
    for name in names(root):
        source, destination = live / name, managed / name
        if linked(source, destination):
            require(destination.exists(), f"broken managed link: {name}")
            continue
        require(not destination.exists() and not destination.is_symlink(), f"already exists in dotfiles: {name}")
        plan.append((name, inventory(source)))
    if not plan:
        print("All selected extensions are already managed.")
        return
    backup = agent / "extension-backups" / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8])
    managed.mkdir(parents=True, exist_ok=True)
    backup.mkdir(parents=True)
    copied, moved = [], []
    try:
        for name, expected in plan:
            source, destination = live / name, managed / name
            copied.append(destination)
            if source.is_dir():
                shutil.copytree(source, destination,
                                ignore=lambda _directory, children: [n for n in children if ignored(n)])
            else:
                shutil.copy2(source, destination)
            require(inventory(destination) == expected and inventory(source) == expected,
                    f"source changed during copy: {name}")
        for name, expected in plan:
            source, destination = live / name, managed / name
            require(inventory(source) == expected, f"source changed before adoption: {name}")
            source.rename(backup / name)
            moved.append(name)
            # Keep installed dependencies usable without network or vendoring them.
            dependencies = backup / name / "node_modules"
            if destination.is_dir() and dependencies.is_dir():
                (destination / "node_modules").symlink_to(dependencies, target_is_directory=True)
            source.symlink_to(destination, target_is_directory=destination.is_dir())
        (backup / "adoption.json").write_text(json.dumps({"root": str(root), "extensions": moved}, indent=2) + "\n")
    except BaseException:
        for name in reversed(moved):
            original = live / name
            if linked(original, managed / name):
                original.unlink()
            require(not original.exists() and not original.is_symlink(), f"rollback conflict: {original}; backup: {backup}")
            (backup / name).rename(original)
        for destination in reversed(copied):
            if destination.is_dir() and not destination.is_symlink():
                shutil.rmtree(destination)
            else:
                destination.unlink(missing_ok=True)
        raise
    print(f"Managed {len(moved)} extensions. Backup: {backup}")


def configure(root, agent, check=False):
    live = agent / "extensions"
    require(not live.is_symlink(), "extensions directory must not be a symlink")
    missing = []
    for name in names(root):
        destination = root / "pi/extensions" / name
        require(destination.exists(), f"missing dotfiles extension: {name}")
        link = live / name
        if linked(link, destination):
            continue
        require(not check, f"not linked: {name}")
        require(not link.exists() and not link.is_symlink(),
                f"existing extension: {name}; use adopt to back it up and migrate")
        missing.append((link, destination))
    if not check:
        live.mkdir(parents=True, exist_ok=True)
        for link, destination in missing:
            link.symlink_to(destination, target_is_directory=destination.is_dir())
    print("Selected extension links are ready.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("adopt", "config", "check"))
    parser.add_argument("--agent-dir", type=Path,
                        default=Path(os.environ.get("PI_CODING_AGENT_DIR", "~/.pi/agent")).expanduser())
    args = parser.parse_args()
    agent = args.agent_dir.expanduser().resolve()
    require(agent != ROOT and ROOT not in agent.parents and agent not in ROOT.parents,
            "agent directory and dotfiles must not overlap")
    if args.command == "adopt":
        adopt(ROOT, agent)
    else:
        configure(ROOT, agent, check=args.command == "check")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        print(f"Pi setup stopped: {error}", file=sys.stderr)
        sys.exit(1)
