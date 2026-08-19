#!/usr/bin/env bash
# Build every harness image and print the resulting sizes.
#
#   ./build.sh              # build all
#   ./build.sh claude       # build a subset (by harness id)
#
# Targets the podman machine `bench-vm` (see README.md). One image per harness, so a
# broken image can never affect the others.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORK_REPO="${FORK_REPO:-$HOME/Work/optimus-prime}"

# harness id -> build context (the Containerfile is always Containerfile.<id>).
# Every image downloads its harness, so the context is empty for all but the fork,
# which COPYs the prebuilt bundle out of the read-only local repo.
context_for() {
	case "$1" in
	optimus-prime) echo "$FORK_REPO/packages/coding-agent" ;;
	*) echo "$HERE" ;;
	esac
}

# Optional extra podman-build args per harness (e.g. an allow-list ignorefile that
# keeps the fork's context at ~14M instead of tarring node_modules).
extra_args_for() {
	case "$1" in
	optimus-prime) echo "--ignorefile $HERE/ignorefile.optimus-prime" ;;
	*) echo "" ;;
	esac
}

# The node-based images build FROM localhost/bench/base:pinned, so the base is built first and is
# not itself a harness. See Containerfile.base for why they share a base but not one image.
BASE_IMAGE=base
ALL=(optimus-prime prime-agent-upstream claude opencode hermes codex cursor pi oh-my-pi cline aider terminus-2 qwen-code terminus-kira)
WANTED=("${@+$@}")
if [ ${#WANTED[@]} -eq 0 ]; then WANTED=("${ALL[@]}"); fi

# Always current before anything that inherits it; cheap when its layers are cached.
echo "== build $BASE_IMAGE"
if ! podman build -t "bench/$BASE_IMAGE:pinned" -f "$HERE/Containerfile.$BASE_IMAGE" "$HERE"; then
	echo "!! base image failed; the node-based harnesses cannot build" >&2
	exit 1
fi

built=()
failed=()
for id in "${WANTED[@]}"; do
	file="$HERE/Containerfile.$id"
	if [ ! -f "$file" ]; then
		echo "== skip $id (no $file)"
		continue
	fi
	ctx="$(context_for "$id")"
	read -r -a extra <<<"$(extra_args_for "$id")"
	echo "== build $id  (context: $ctx)"
	if podman build -t "bench/$id:pinned" -f "$file" ${extra[@]+"${extra[@]}"} "$ctx"; then
		built+=("$id")
	else
		echo "!! FAILED: $id"
		failed+=("$id")
	fi
done

echo
printf '%-44s %-12s %s\n' IMAGE SIZE ID
for id in ${built[@]+"${built[@]}"}; do
	podman images --format "{{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.ID}}" "bench/$id:pinned" |
		awk -F'\t' '{printf "%-44s %-12s %s\n", $1, $2, $3}'
done

if [ ${#failed[@]} -gt 0 ]; then
	echo
	echo "failed: ${failed[*]}"
	exit 1
fi
