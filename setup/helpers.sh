#!/usr/bin/env bash
# Sourced by Make recipes; never writes profiles or replaces existing configs.
set -eu

# Resolve existing Homebrew executables without editing a shell profile.
if ! command -v brew >/dev/null; then
    for prefix in /opt/homebrew/bin /usr/local/bin; do
        if [[ -x "$prefix/brew" ]]; then export PATH="$prefix:$PATH"; break; fi
    done
fi

fail() { printf '%s\n' "$*" >&2; return 1; }

link_config() {
    local source=$1 target=$2
    [[ -e "$source" ]] || { fail "Missing config: $source"; return 1; }
    if [[ -L "$target" && "$source" -ef "$target" ]]; then
        return
    fi
    if [[ -e "$target" || -L "$target" ]]; then
        fail "Conflict: $target (back it up yourself, then retry)"
        return 1
    fi
    mkdir -p -- "$(dirname -- "$target")"
    ln -s -- "$source" "$target"
    printf 'Linked: %s\n' "$target"
}

check_link() {
    [[ -L "$2" && "$1" -ef "$2" ]] || fail "Config not linked: $2"
}

require_commands() {
    local command missing=0
    for command in "$@"; do
        command -v "$command" >/dev/null || { printf 'Missing command: %s\n' "$command" >&2; missing=1; }
    done
    return "$missing"
}

brew_install() {
    local kind=$1 package
    shift
    command -v brew >/dev/null || { fail 'Install Homebrew first: https://brew.sh'; return 1; }
    for package in "$@"; do
        if ! brew list "$kind" --versions "$package" >/dev/null 2>&1; then
            HOMEBREW_NO_AUTO_UPDATE=1 brew install "$kind" "$package"
        fi
    done
}

download_once() (
    local url=$1 destination=$2 temporary
    if [[ -e "$destination" || -L "$destination" ]]; then
        [[ -f "$destination" && -s "$destination" ]] || fail "Invalid existing download: $destination"
        exit
    fi
    mkdir -p -- "$(dirname -- "$destination")"
    temporary=$(mktemp "${destination}.XXXXXX")
    trap 'rm -f -- "$temporary"' EXIT
    curl --fail --show-error --silent --location --proto '=https' --proto-redir '=https' "$url" -o "$temporary"
    [[ -s "$temporary" ]] || { fail "Empty download: $url"; exit 1; }
    mv -- "$temporary" "$destination"
)

clone_once() {
    local url=$1 destination=$2 ref=${3:-} origin
    if [[ -e "$destination" || -L "$destination" ]]; then
        [[ -d "$destination/.git" ]] || { fail "Not a Git checkout: $destination"; return 1; }
        origin=$(git -C "$destination" remote get-url origin)
        [[ ${origin%.git} == "${url%.git}" ]] || { fail "Unexpected origin: $destination"; return 1; }
        return
    fi
    mkdir -p -- "$(dirname -- "$destination")"
    if [[ -n "$ref" ]]; then
        git clone --depth 1 --branch "$ref" "$url" "$destination"
    else
        git clone --depth 1 "$url" "$destination"
    fi
}

use_node() {
    # Third-party shell initializers are not guaranteed to tolerate nounset.
    set +u
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh" --no-use
    nvm use --silent "$NODE_VERSION"
    set -u
}
