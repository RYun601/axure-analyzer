#!/usr/bin/env bash
#
# Install the axure-analyzer skill on macOS.
#
# By default installs to <project>/.opencode/skills/axure-analyzer.
# Use --skills-root to install to a global or custom skills directory.
#
# Examples:
#   bash ./install.sh --install-deps
#   bash ./install.sh --skills-root "$HOME/.agents/skills" --install-deps
#   bash ./install.sh --project-root "/path/to/project" --install-deps

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash install.sh [options]

Options:
  --project-root <path>   Project root (default: current directory)
  --skills-root <path>    Skills root (default: <project>/.opencode/skills)
  --install-deps          Run npm install in the installed skill directory
  -h, --help              Show this help
EOF
}

PROJECT_ROOT="$(pwd)"
SKILLS_ROOT=""
INSTALL_DEPS=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-root)
      PROJECT_ROOT="$2"
      shift 2
      ;;
    --skills-root)
      SKILLS_ROOT="$2"
      shift 2
      ;;
    --install-deps)
      INSTALL_DEPS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "$SKILLS_ROOT" ]; then
  SKILLS_ROOT="$PROJECT_ROOT/.opencode/skills"
fi

DEST="$SKILLS_ROOT/axure-analyzer"

mkdir -p "$DEST"
rm -rf "$DEST/scripts" "$DEST/references"

cp "$SCRIPT_DIR/SKILL.md" "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/LICENSE" "$DEST/"
cp -R "$SCRIPT_DIR/scripts" "$DEST/scripts"
cp -R "$SCRIPT_DIR/references" "$DEST/references"

if [ "$INSTALL_DEPS" -eq 1 ]; then
  (cd "$DEST" && npm install --omit=dev --no-audit --no-fund)
fi

# npm dependencies may ship their own SKILL.md (for example playwright-core's
# lib/tools/skills). OpenCode treats those as separate skills, so clean them up.
if [ -d "$DEST/node_modules" ]; then
  node "$DEST/scripts/strip-node-modules-skills.js"
fi

echo "Installed skill: $DEST"
echo "Verify with:"
echo "  node \"$DEST/scripts/analyze.js\" --input \"D:/path/to/axure-export\" --output \"analysis/axure\" --pages \"PageName\""
echo ""
echo "Note: if the skill is not listed immediately, restart the agent session."
echo "      OpenChamber users: run 'OpenChamber: Restart API' or reload the VS Code window; do not kill the OpenCode backend process."
