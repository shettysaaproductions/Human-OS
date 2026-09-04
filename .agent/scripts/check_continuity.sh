#!/usr/bin/env bash
# check_continuity.sh - READ-ONLY continuity-state validator for Human-OS.
#
# Compares the recorded state in .agent/CURRENT_HANDOFF.md against live git
# state, verifies the handoff contains every required section, and scans
# .agent/ continuity files for leaked secrets.
#
# This script NEVER modifies, deletes, resets, force-pushes, or writes to
# any branch or file. It only reads.
#
# Usage:
#   bash .agent/scripts/check_continuity.sh
#   bash .agent/scripts/check_continuity.sh --expect-branch <name> --expect-commit <sha>
#
# Exit codes:
#   0  VERIFIED (state matches, sections complete, no secrets, clean tree)
#   1  MISMATCH / STALE / invalid handoff (detected problem)
#   2  usage or environment error

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
HANDOFF="${ROOT}/.agent/CURRENT_HANDOFF.md"
SCAN_DIR="${ROOT}/.agent"

EXPECT_BRANCH=""
EXPECT_COMMIT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect-branch)
      EXPECT_BRANCH="$2"; shift 2 ;;
    --expect-commit)
      EXPECT_COMMIT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,18p' "$0"; exit 0 ;;
    *)
      echo "check_continuity: unknown argument: $1" >&2
      exit 2 ;;
  esac
done

if [[ ! -f "${HANDOFF}" ]]; then
  echo "check_continuity: handoff not found: ${HANDOFF}" >&2
  exit 2
fi
if ! git -C "${ROOT}" rev-parse --git-dir >/dev/null 2>&1; then
  echo "check_continuity: ${ROOT} is not a git repository" >&2
  exit 2
fi

FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

echo "=== Human-OS continuity state check ==="
echo "repo:      ${ROOT}"

# --- 1. Parse Checkpoint Information from handoff ---------------------
get_cp() { # $1 = KEY
  awk -v key="$1" '$0 ~ "^" key "=" { sub("^" key "=", ""); print; exit }' "${HANDOFF}"
}

CP_BRANCH="$(get_cp CHECKPOINT_BRANCH)"
CP_BASE="$(get_cp BASE_COMMIT)"
CP_COMMIT="$(get_cp CHECKPOINT_COMMIT)"
CP_TREE="$(get_cp WORKING_TREE_STATE)"

# --- 2. Live git state ------------------------------------------------
LIVE_BRANCH="$(git -C "${ROOT}" branch --show-current)"
LIVE_HEAD="$(git -C "${ROOT}" rev-parse HEAD 2>/dev/null)"
LIVE_PORCELAIN="$(git -C "${ROOT}" status --porcelain)"

# --- 3. Branch check ---------------------------------------------------
EXPECTED_BRANCH="${EXPECT_BRANCH:-${CP_BRANCH}}"
echo "--- Branch ---"
echo "recorded branch: ${CP_BRANCH:-<missing>}"
echo "live branch:     ${LIVE_BRANCH:-<detached>}"
if [[ -z "${EXPECTED_BRANCH}" ]]; then
  fail "CHECKPOINT_BRANCH is missing from Checkpoint Information"
elif [[ "${LIVE_BRANCH}" != "${EXPECTED_BRANCH}" ]]; then
  fail "branch mismatch: on '${LIVE_BRANCH}', handoff expects '${EXPECTED_BRANCH}' (STALE or wrong checkout)"
else
  pass "branch matches '${EXPECTED_BRANCH}'"
fi

# --- 4. Commit check ---------------------------------------------------
EXPECTED_COMMIT="${EXPECT_COMMIT:-${CP_COMMIT}}"
echo "--- Commit ---"
echo "recorded checkpoint commit: ${CP_COMMIT:-<missing>}"
echo "recorded base commit:       ${CP_BASE:-<missing>}"
echo "live HEAD:                  ${LIVE_HEAD:-<none>}"
if [[ -z "${EXPECTED_COMMIT}" || "${EXPECTED_COMMIT}" == "<PENDING"* ]]; then
  fail "CHECKPOINT_COMMIT is missing or pending in Checkpoint Information"
elif [[ "${LIVE_HEAD}" == "${EXPECTED_COMMIT}" ]]; then
  pass "HEAD is exactly the checkpoint commit"
elif git -C "${ROOT}" merge-base --is-ancestor "${EXPECTED_COMMIT}" "${LIVE_HEAD}" 2>/dev/null; then
  pass "HEAD descends from checkpoint commit"
else
  fail "commit mismatch: HEAD '${LIVE_HEAD}' does not contain checkpoint commit '${EXPECTED_COMMIT}' (STALE)"
fi
if [[ -n "${CP_BASE}" ]] && ! git -C "${ROOT}" merge-base --is-ancestor "${CP_BASE}" "${LIVE_HEAD}" 2>/dev/null; then
  fail "base commit '${CP_BASE}' is not an ancestor of HEAD"
elif [[ -n "${CP_BASE}" ]]; then
  pass "base commit is an ancestor of HEAD"
fi

# --- 5. Working-tree state ---------------------------------------------
echo "--- Working tree ---"
if [[ -z "${LIVE_PORCELAIN}" ]]; then
  pass "working tree is clean"
elif [[ "${CP_TREE}" == *"clean"* ]]; then
  fail "working tree has uncommitted changes but handoff recorded clean:"
  echo "----- git status --porcelain -----"
  echo "${LIVE_PORCELAIN}"
  echo "----------------------------------"
else
  pass "working tree has expected uncommitted state (handoff records: ${CP_TREE})"
fi

# --- 6. Required sections ----------------------------------------------
echo "--- Handoff sections ---"
REQUIRED_SECTIONS=(
  "# CURRENT HANDOFF"
  "## Last Updated"
  "## Session / Agent"
  "## Current Task"
  "## Objective"
  "## Status"
  "## Repository State"
  "## Confirmed Findings"
  "## Root Cause"
  "## Decisions"
  "## Implementation Completed"
  "## Tests Added"
  "## Test Results"
  "## Known Failures"
  "## Unresolved Questions"
  "## Important Invariants"
  "## DO NOT REDO"
  "## NEXT ACTION"
  "## Safe To Continue?"
  "## Checkpoint Information"
)
for s in "${REQUIRED_SECTIONS[@]}"; do
  if grep -qF "${s}" "${HANDOFF}"; then
    pass "section present: ${s}"
  else
    fail "missing section: ${s}"
  fi
done

# --- 7. NEXT ACTION sanity ---------------------------------------------
echo "--- NEXT ACTION ---"
NA="$(awk '/^## NEXT ACTION$/{f=1;next}/^## /{f=0}f' "${HANDOFF}" | grep -v '^$' | head -1)"
if [[ -z "${NA}" ]]; then
  fail "NEXT ACTION is empty"
elif [[ "$(echo "${NA}" | tr '[:upper:]' '[:lower:]')" == "continue working" ]]; then
  fail "NEXT ACTION must be a concrete action, not 'continue working'"
else
  pass "NEXT ACTION is concrete"
fi

# --- 8. Safe To Continue ------------------------------------------------
echo "--- Safe To Continue ---"
STC="$(awk '/^## Safe To Continue\?$/{f=1;next}/^## /{f=0}f' "${HANDOFF}" | grep -v '^$' | head -1 | tr '[:lower:]' '[:upper:]')"
if [[ "${STC}" == "YES" ]]; then
  pass "Safe To Continue? = YES"
else
  fail "Safe To Continue? is not YES (found: '${STC:-<empty>}')"
fi

# --- 9. Secret scan ------------------------------------------------------
echo "--- Secret scan (.agent/) ---"
SECRET_HITS="$(grep -rInE '(api[_-]?key|secret|password|passwd|access[_-]?token|refresh[_-]?token|bearer)[[:space:]]*[=:][[:space:]]*[A-Za-z0-9_./\-]{8,}' "${SCAN_DIR}" 2>/dev/null | grep -v '\.git/' || true)"
if [[ -n "${SECRET_HITS}" ]]; then
  fail "possible secret-like assignment found in .agent/:"
  echo "${SECRET_HITS}"
else
  pass "no secret-like assignments found in .agent/"
fi

# --- Verdict ------------------------------------------------------------
echo "============================================"
if [[ ${FAIL} -eq 0 ]]; then
  echo "CONTINUITY VERIFIED"
  echo "State matches handoff. Safe to continue from NEXT ACTION."
  exit 0
else
  echo "CONTINUITY MISMATCH / STALE"
  echo "Do NOT code. Resolve the mismatches above, then re-run this check."
  exit 1
fi
