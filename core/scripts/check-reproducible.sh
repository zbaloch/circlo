#!/usr/bin/env bash
# Reproducible-build check (PLAN.md Phase 12): builds the release library from two copies of the source in
# different directories and fails unless the results are byte-identical. Paths are remapped so the build location
# doesn't leak into the binary. Usage: core/scripts/check-reproducible.sh [cargo build args...]
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cargo_home="${CARGO_HOME:-$HOME/.cargo}"
args=("$@")
[ ${#args[@]} -eq 0 ] && args=(--release --lib)

build() {
  local dir="$work/$1"
  mkdir -p "$dir"
  (cd "$src" && git ls-files -z . | xargs -0 -I{} cp --parents {} "$dir/")
  (cd "$dir" && RUSTFLAGS="--remap-path-prefix=$dir=/circlo --remap-path-prefix=$cargo_home=/cargo" \
    CARGO_TARGET_DIR="$dir/target" cargo build --locked "${args[@]}" >&2)
  find "$dir/target/release" -maxdepth 1 -type f \( -name 'libcirclo_core.so' -o -name 'libcirclo_core.a' \) -print0 \
    | sort -z | xargs -0 sha256sum | sed "s#$dir/##"
}

a="$(build a)"
b="$(build b)"
echo "$a"
if [ "$a" != "$b" ]; then
  echo "NOT reproducible:" >&2
  echo "$b" >&2
  exit 1
fi
echo "reproducible: both builds are byte-identical"
