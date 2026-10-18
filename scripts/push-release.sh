#!/usr/bin/env bash
# Commit first; run the maintainer's tests/review before opting into publication.
set -euo pipefail

fail() { printf 'push-release: %s\n' "$*" >&2; exit 1; }
publish=false
case "${1:-}" in
  '') [[ $# == 0 ]] || fail 'Usage: scripts/push-release.sh [--publish]' ;;
  --publish) [[ $# == 1 ]] || fail 'Usage: scripts/push-release.sh [--publish]'; publish=true ;;
  *) fail 'Usage: scripts/push-release.sh [--publish]' ;;
esac
for tool in git gh python3; do
  command -v "$tool" >/dev/null || fail "Required command missing: $tool"
done
cd "$(dirname "$0")/.."
cd "$(git rev-parse --show-toplevel)"
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail 'Checkout must be clean; keep unrelated edits separate and use a clean checkout.'
branch_ref=$(git symbolic-ref --quiet HEAD) || fail 'HEAD must be on a named branch (not detached).'
[[ $branch_ref == refs/heads/* ]] || fail 'HEAD must name a local branch.'
branch=${branch_ref#refs/heads/}
head=$(git rev-parse --verify HEAD)

# Validate every effective fetch/push URL, including pushurl and URL rewrites.
for direction in fetch push; do
  if [[ $direction == push ]]; then
    urls=$(git remote get-url --push --all origin)
  else
    urls=$(git remote get-url --all origin)
  fi
  [[ -n "$urls" ]] || fail 'origin is missing.'
  count=0
  while IFS= read -r url; do
    case "$url" in
      https://github.com/kkgams/gams|https://github.com/kkgams/gams.git|git@github.com:kkgams/gams|git@github.com:kkgams/gams.git|ssh://git@github.com/kkgams/gams|ssh://git@github.com/kkgams/gams.git) ;;
      *) fail "origin $direction URL must be canonical kkgams/gams: $url" ;;
    esac
    count=$((count + 1))
  done <<< "$urls"
  [[ $count == 1 ]] || fail "origin must have exactly one $direction URL."
done
# A mirror remote can override the safety of explicit push refspecs.
mirror=$(git config --bool --get remote.origin.mirror || [[ $? == 1 ]])
[[ $mirror != true ]] || fail 'origin must not be configured as a mirror.'

version=$(python3 - <<'PY'
import json
import re
import subprocess
import tomllib

def committed(path):
    return subprocess.check_output(['git', 'show', 'HEAD:' + path]).decode()

cargo = tomllib.loads(committed('cmd/app/src-tauri/Cargo.toml'))['package']['version']
tauri = json.loads(committed('cmd/app/src-tauri/tauri.conf.json'))['version']
number = r'(?:0|[1-9][0-9]*)'
version = rf'{number}\.{number}\.{number}'
if not isinstance(cargo, str) or cargo != tauri or not re.fullmatch(version, cargo):
    raise SystemExit('push-release: committed Cargo/Tauri versions must match MAJOR.MINOR.PATCH without suffixes.')
print(cargo)
PY
)
tag="v$version"
local_tag=false
if git show-ref --verify --quiet "refs/tags/$tag"; then
  [[ $(git rev-parse --verify "refs/tags/$tag^{commit}") == "$head" ]] || fail "Local $tag must point to HEAD."
  local_tag=true
else
  status=$?
  [[ $status == 1 ]] || fail "Cannot inspect local $tag."
fi

gh auth status --hostname github.com || fail 'GitHub authentication check failed.'
repository=$(gh api --hostname github.com --method GET repos/kkgams/gams) || fail 'GitHub repository access check failed.'
printf '%s' "$repository" | python3 -c '
import json, sys
repo = json.load(sys.stdin)
if not isinstance(repo, dict) or repo.get("full_name") != "kkgams/gams" or not isinstance(repo.get("permissions"), dict) or repo["permissions"].get("push") is not True:
    raise SystemExit("push-release: GitHub token needs repository push access to inspect draft releases.")
'
# Without --exit-code, a successful empty response means absence; transport errors
# still fail. Both lightweight and annotated remote tags match this exact ref.
remote_tag=$(git ls-remote --refs origin "refs/tags/$tag") || fail 'Remote tag check failed (authentication or transport).'
[[ -z "$remote_tag" ]] || fail "Remote tag $tag already exists."
releases=$(gh api --hostname github.com --method GET --paginate --slurp 'repos/kkgams/gams/releases?per_page=100') || fail 'GitHub Releases API check failed.'
printf '%s' "$releases" | python3 -c '
import json, sys
pages = json.load(sys.stdin)
if not isinstance(pages, list) or not pages or any(not isinstance(page, list) for page in pages):
    raise SystemExit("push-release: malformed Releases API pages.")
for page in pages:
    for release in page:
        if not isinstance(release, dict) or not isinstance(release.get("tag_name"), str):
            raise SystemExit("push-release: malformed Release record.")
        if release["tag_name"] == sys.argv[1]:
            raise SystemExit("push-release: GitHub Release already exists for " + sys.argv[1])
' "$tag"

[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail 'Checkout changed during preflight.'
[[ $(git symbolic-ref --quiet HEAD) == "$branch_ref" ]] || fail 'Branch changed during preflight.'
[[ $(git rev-parse --verify HEAD) == "$head" ]] || fail 'HEAD changed during preflight.'
if $local_tag; then
  [[ $(git rev-parse --verify "refs/tags/$tag^{commit}") == "$head" ]] || fail 'Local tag changed during preflight.'
fi

printf 'Preflight passed: %s at %s on %s (kkgams/gams).\n' "$tag" "$head" "$branch"
printf 'Publish command: git push --atomic --no-follow-tags origin %s:refs/heads/%s refs/tags/%s:refs/tags/%s\n' "$head" "$branch" "$tag" "$tag"
if ! $publish; then
  printf 'Dry run only: no tag created and nothing pushed. Use --publish after maintainer tests/review.\n'
  exit 0
fi
# Do not move an existing tag. On a failed push, keep the local tag for inspection
# and retry; never fall back to separate non-atomic pushes.
if ! $local_tag; then
  git tag -a "$tag" "$head" -m "Release $tag"
fi
git push --atomic --no-follow-tags origin "$head:refs/heads/$branch" "refs/tags/$tag:refs/tags/$tag"
printf 'Pushed %s and %s atomically; CI creates the GitHub Release.\n' "$branch" "$tag"
