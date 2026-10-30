#!/usr/bin/env bash
# Build-time installer for Agent Skills, pinned by commit SHA.
#
# Usage: install-skills.sh <destination-dir> <manifest-file>
#
# Installs:
#   1. Every dt-* skill with a valid SKILL.md from Dynatrace/dynatrace-for-ai.
#   2. Every valid skill under skills/ of the custom RCA repository. The step
#      fails with a clear error when that repository has no valid SKILL.md.
#   3. The first-party draw.io skill shipped in this repository.
#
# Environment:
#   DT_SKILLS_REPO   (default https://github.com/Dynatrace/dynatrace-for-ai.git)
#   DT_SKILLS_REF    full 40-character commit SHA (required)
#   RCA_SKILLS_REPO  (default https://github.com/Edunzz/dynatrace_ai_skills_rca.git)
#   RCA_SKILLS_REF   full 40-character commit SHA (required)
#   DRAWIO_SKILL_DIR (default /build/skills/drawio)

set -Eeuo pipefail

dest="${1:?usage: install-skills.sh <destination-dir> <manifest-file>}"
manifest="${2:?usage: install-skills.sh <destination-dir> <manifest-file>}"
DT_SKILLS_REPO="${DT_SKILLS_REPO:-https://github.com/Dynatrace/dynatrace-for-ai.git}"
DT_SKILLS_REF="${DT_SKILLS_REF:?DT_SKILLS_REF must be a commit SHA}"
RCA_SKILLS_REPO="${RCA_SKILLS_REPO:-https://github.com/Edunzz/dynatrace_ai_skills_rca.git}"
RCA_SKILLS_REF="${RCA_SKILLS_REF:?RCA_SKILLS_REF must be a commit SHA}"
DRAWIO_SKILL_DIR="${DRAWIO_SKILL_DIR:-/build/skills/drawio}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$dest"

log() { printf 'install-skills: %s\n' "$*" >&2; }

fetch_pinned() {
  local repo="$1" ref="$2" dir="$3"
  [[ "$ref" =~ ^[0-9a-f]{40}$ ]] || { log "ref for $repo must be a full commit SHA (got '$ref')"; return 1; }
  git init -q "$dir"
  git -C "$dir" remote add origin "$repo"
  git -C "$dir" -c protocol.version=2 fetch -q --depth 1 origin "$ref"
  git -C "$dir" checkout -q FETCH_HEAD
  local actual
  actual="$(git -C "$dir" rev-parse HEAD)"
  [[ "$actual" == "$ref" ]] || { log "checked out $actual, expected $ref"; return 1; }
}

# Prints the skill name when <dir>/SKILL.md has valid Agent Skills frontmatter.
valid_skill_name() {
  local dir="$1" file="$1/SKILL.md"
  [[ -f "$file" ]] || return 1
  [[ "$(head -n 1 "$file" | tr -d '\r')" == "---" ]] || return 1
  local front name description
  front="$(awk 'NR == 1 {next} /^---[[:space:]]*$/ {exit} {print}' "$file" | tr -d '\r')"
  name="$(printf '%s\n' "$front" | sed -n 's/^name:[[:space:]]*["'\'']\{0,1\}\([^"'\'']*\)["'\'']\{0,1\}[[:space:]]*$/\1/p' | head -n 1)"
  description="$(printf '%s\n' "$front" | sed -n 's/^description:[[:space:]]*\(.*\)$/\1/p' | head -n 1)"
  [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]] || return 1
  [[ -n "$description" ]] || return 1
  [[ "$name" == "$(basename "$dir")" ]] || return 1
  printf '%s' "$name"
}

# 1. Official Dynatrace skills -------------------------------------------------
fetch_pinned "$DT_SKILLS_REPO" "$DT_SKILLS_REF" "$work/official"
official=()
skipped=()
for dir in "$work/official/skills"/dt-*/; do
  dir="${dir%/}"
  if name="$(valid_skill_name "$dir")"; then
    cp -a "$dir" "$dest/$name"
    official+=("$name")
  else
    skipped+=("$(basename "$dir")")
  fi
done
((${#official[@]} > 0)) || { log "no valid dt-* skills found in $DT_SKILLS_REPO@$DT_SKILLS_REF"; exit 1; }
log "installed ${#official[@]} official skills"
((${#skipped[@]} == 0)) || log "skipped incompatible skills: ${skipped[*]}"

# 2. Custom RCA skills ----------------------------------------------------------
fetch_pinned "$RCA_SKILLS_REPO" "$RCA_SKILLS_REF" "$work/rca"
custom_json="[]"
if [[ -d "$work/rca/skills" ]]; then
  for dir in "$work/rca/skills"/*/; do
    dir="${dir%/}"
    if name="$(valid_skill_name "$dir")"; then
      if [[ -e "$dest/$name" ]]; then log "custom skill '$name' collides with an installed skill"; exit 1; fi
      cp -a "$dir" "$dest/$name"
      version="$(sed -n 's/^[[:space:]]*version:[[:space:]]*["'\'']\{0,1\}\([^"'\'']*\)["'\'']\{0,1\}[[:space:]]*$/\1/p' "$dir/SKILL.md" | head -n 1)"
      custom_json="$(jq -c --arg n "$name" --arg v "$version" --arg r "$RCA_SKILLS_REPO" --arg ref "$RCA_SKILLS_REF" \
        '. + [{name: $n, version: (if $v == "" then null else $v end), repo: $r, ref: $ref}]' <<<"$custom_json")"
    fi
  done
fi
if [[ "$(jq 'length' <<<"$custom_json")" == "0" ]]; then
  cat >&2 <<EOF
install-skills: ERROR: no valid custom skill found in $RCA_SKILLS_REPO@$RCA_SKILLS_REF.
Expected structure (Agent Skills format, name must match the directory):

  skills/
  └── <skill-name>/
      ├── SKILL.md        (frontmatter with 'name: <skill-name>' and 'description: ...')
      ├── references/
      ├── scripts/
      └── assets/

Fix the repository or pin RCA_SKILLS_REF to a commit that contains a valid skill.
EOF
  exit 1
fi
log "installed custom skills: $(jq -r 'map(.name) | join(", ")' <<<"$custom_json")"

# 3. First-party draw.io skill -----------------------------------------------------
drawio_name="$(valid_skill_name "$DRAWIO_SKILL_DIR")" || { log "invalid draw.io skill at $DRAWIO_SKILL_DIR"; exit 1; }
cp -a "$DRAWIO_SKILL_DIR" "$dest/$drawio_name"

# Skills are data: no executable bits except the scripts the skills ship.
find "$dest" -type d -exec chmod 0755 {} +
find "$dest" -type f -exec chmod 0644 {} +
find "$dest" -type f \( -name '*.py' -o -name '*.sh' -o -name '*.mjs' \) -path '*/scripts/*' -exec chmod 0755 {} +

printf '%s\n' "${official[@]}" | jq -R . | jq -s \
  --arg repo "$DT_SKILLS_REPO" --arg ref "$DT_SKILLS_REF" \
  --argjson custom "$custom_json" --arg drawio "$drawio_name" \
  '{schemaVersion: 1, official: {repo: $repo, ref: $ref, skills: .}, custom: $custom, drawio: {name: $drawio, source: "rocky-agent"}}' >"$manifest"
log "manifest written to $manifest"
