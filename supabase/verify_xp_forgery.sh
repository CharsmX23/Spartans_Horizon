#!/usr/bin/env bash
# XP ledger — prove a crafted client request cannot mint XP.
#
# The catalog queries at the bottom of 20260813130000_xp_events.sql show what Postgres
# *will* enforce; this shows it actually refusing, using the same anon key and a real user
# JWT that the browser has. Nothing here is privileged — it is exactly what someone
# holding the (public) anon key and their own login could attempt from the console.
#
# The shape of the risk this checks is specific. `path_phases.status` and `goals.status`
# are FREELY client-writable by design (20260808120000 took the photo gate off phases on
# purpose). So "can I write status?" is the wrong question — the answer is yes, and should
# stay yes. The question is: can I turn that into unbounded XP? Two ways to try:
#
#   A. Write the ledger directly.        -> must be refused at the grant layer.
#   B. Toggle a phase/goal in a loop.    -> must be allowed, and must never accumulate.
#
# Since 20260813150000 phase/goal XP is a LIVE MIRROR of current state, so B has a second
# half: the XP must also come back off when the phase leaves completed or is deleted.
# Sections 4-6 are that half.
#
#   3. six completions, landing on completed   -> exactly +100
#   4. the full cycle: on, off, on, delete     -> +100, baseline, +100, baseline
#   5. six completions, landing on PENDING     -> exactly baseline (the new test; this is
#      the one that would have read +100 under the old permanent model)
#   6. proof/habit XP is untouched by all of it -> permanent, byte-identical before/after
#
# Section 6 is the negative control. Everything else here proves XP can be taken away;
# section 6 proves the taking-away cannot reach a streak or habit grant.
#
# Usage:  ./verify_xp_forgery.sh <username> <password>

set -euo pipefail
cd "$(dirname "$0")/.."

USERNAME="${1:?usage: verify_xp_forgery.sh <username> <password>}"
PASSWORD="${2:?usage: verify_xp_forgery.sh <username> <password>}"

URL=$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2-)
KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2-)

echo "Project: $URL"
echo

# ── Sign in exactly as the browser does ────────────────────────────────────
LOGIN=$(curl -s "$URL/auth/v1/token?grant_type=password" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"${USERNAME}@spartans.local\",\"password\":\"${PASSWORD}\"}")

TOKEN=$(printf '%s' "$LOGIN" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4 || true)
UID_=$(printf '%s' "$LOGIN" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

if [ -z "$TOKEN" ]; then
  echo "Sign-in failed. Response:"; echo "$LOGIN"; exit 1
fi
echo "Signed in as $USERNAME ($UID_)"
echo

auth=(-H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

probe() { # description, expectation, curl args...
  local desc="$1" expect="$2"; shift 2
  local code; code=$(curl -s -o /tmp/spartan_xp_body -w '%{http_code}' "$@")
  echo "  $desc"
  echo "    expect: $expect"
  echo "    got:    HTTP $code $(head -c 220 /tmp/spartan_xp_body)"
  echo
}

# Lifetime XP, read the same way the header reads it.
xp_total() {
  curl -s "$URL/rest/v1/xp_events?select=amount" "${auth[@]}" \
    | grep -o '"amount":[0-9]*' | cut -d: -f2 \
    | awk '{ s += $1 } END { print s + 0 }'
}

# The permanent half of the ledger — streak proofs and habit completions. Nothing in this
# script may change this number, and section 6 asserts it.
proof_total() {
  curl -s "$URL/rest/v1/xp_events?select=amount&source_type=in.(proof,habit_physical)" "${auth[@]}" \
    | grep -o '"amount":[0-9]*' | cut -d: -f2 \
    | awk '{ s += $1 } END { print s + 0 }'
}

FAILURES=0
# Compare two numbers and say so loudly. Every expectation in sections 3-6 goes through
# here so the script has a verdict rather than a wall of output to read by eye.
expect_eq() { # description, actual, expected
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "    PASS  $desc — $actual"
  else
    echo "    FAIL  $desc — got $actual, expected $expected"
    FAILURES=$((FAILURES + 1))
  fi
}

set_status() { # table, id, status
  curl -s -o /dev/null -X PATCH "$URL/rest/v1/$1?id=eq.$2" "${auth[@]}" -d "{\"status\":\"$3\"}"
}

echo "══ 1. Reads work; the ledger is visible but not writable ══"
probe "read own ledger" "200 + rows (or [] on a fresh account)" \
  "$URL/rest/v1/xp_events?select=source_type,amount,created_at&order=created_at.desc&limit=5" "${auth[@]}"

echo "══ 2. Direct forgery — every one of these MUST be refused ══"
probe "POST a 999999 XP grant for myself" "403 — permission denied for table xp_events" \
  -X POST "$URL/rest/v1/xp_events" "${auth[@]}" \
  -d "{\"user_id\":\"$UID_\",\"source_type\":\"phase\",\"source_id\":\"11111111-1111-1111-1111-111111111111\",\"amount\":999999}"

probe "POST without user_id, hoping for a column default" "403 — permission denied for table xp_events" \
  -X POST "$URL/rest/v1/xp_events" "${auth[@]}" \
  -d '{"source_type":"goal_long","source_id":"22222222-2222-2222-2222-222222222222","amount":500}'

probe "PATCH an existing grant to a bigger amount" "403 — permission denied for table xp_events" \
  -X PATCH "$URL/rest/v1/xp_events?user_id=eq.$UID_" "${auth[@]}" -d '{"amount":999999}'

probe "DELETE a grant to re-earn it" "403 — permission denied for table xp_events" \
  -X DELETE "$URL/rest/v1/xp_events?user_id=eq.$UID_" "${auth[@]}"

probe "call grant_xp() directly" "404 — not exposed / not executable by authenticated" \
  -X POST "$URL/rest/v1/rpc/grant_xp" "${auth[@]}" \
  -d "{\"p_user_id\":\"$UID_\",\"p_source_type\":\"phase\",\"p_source_id\":\"33333333-3333-3333-3333-333333333333\",\"p_amount\":999999}"

probe "call record_checkin() directly (still service_role only)" "404 or 403 — not callable by authenticated" \
  -X POST "$URL/rest/v1/rpc/record_checkin" "${auth[@]}" \
  -d "{\"p_user_id\":\"$UID_\",\"p_note\":\"forged\"}"

probe "read someone else's ledger" "200 with [] — RLS scopes to auth.uid()" \
  "$URL/rest/v1/xp_events?select=amount&user_id=neq.$UID_&limit=5" "${auth[@]}"

# Captured before any mutation below, asserted again at the very end.
PROOF_BEFORE=$(proof_total)

echo "══ 3. The toggle farm — allowed to toggle, never accumulates ══"
echo "  Needs a phase you own that is not already completed."
echo "  Find one:  curl -s \"\$URL/rest/v1/path_phases?select=id,title,status&user_id=eq.$UID_&status=neq.completed&limit=1\""
echo

PHASE_ID="${PHASE_ID:-}"
if [ -z "$PHASE_ID" ]; then
  PHASE_ID=$(curl -s "$URL/rest/v1/path_phases?select=id&user_id=eq.$UID_&status=neq.completed&limit=1" "${auth[@]}" \
    | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
fi

if [ -z "$PHASE_ID" ]; then
  echo "  SKIPPED — no incomplete phase found. Create one in Power Up, or set PHASE_ID=<uuid> and re-run."
  echo "  Sections 4 and 5 need it too and will skip with it."
  echo
  BASELINE=""
else
  # Whatever this phase was, it goes back to it at the end. The script borrows a real row;
  # it must not leave it somewhere the user did not put it.
  ORIG_STATUS=$(curl -s "$URL/rest/v1/path_phases?select=status&id=eq.$PHASE_ID" "${auth[@]}" \
    | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "  Using phase $PHASE_ID (currently '$ORIG_STATUS')"

  BASELINE=$(xp_total); echo "  Baseline XP: $BASELINE"

  for i in 1 2 3 4 5; do
    set_status path_phases "$PHASE_ID" completed
    set_status path_phases "$PHASE_ID" pending
    echo "  toggle $i done (both writes accepted — the triggers never block)"
  done
  set_status path_phases "$PHASE_ID" completed

  echo "  Six completions, landing on 'completed':"
  expect_eq "total after" "$(xp_total)" "$((BASELINE + 100))"
  probe "ledger rows for that phase" "exactly one row, amount 100" \
    "$URL/rest/v1/xp_events?select=source_type,amount&source_id=eq.$PHASE_ID" "${auth[@]}"
fi

echo "══ 4. The cycle — on, off, on. XP must follow the state, both ways ══"
if [ -z "${BASELINE:-}" ]; then
  echo "  SKIPPED — no phase available."
  echo
else
  # Section 3 left it completed, so the ledger is holding its 100 right now.
  echo "  Starting from completed (+100 already banked)."

  set_status path_phases "$PHASE_ID" pending
  expect_eq "un-completed: total drops by exactly 100" "$(xp_total)" "$BASELINE"
  expect_eq "un-completed: ledger rows for that phase" \
    "$(curl -s "$URL/rest/v1/xp_events?select=id&source_id=eq.$PHASE_ID" "${auth[@]}" | grep -c '"id"' || true)" "0"

  set_status path_phases "$PHASE_ID" completed
  expect_eq "re-completed: back to +100, not stacked" "$(xp_total)" "$((BASELINE + 100))"

  set_status path_phases "$PHASE_ID" live
  expect_eq "completed -> live also revokes" "$(xp_total)" "$BASELINE"

  set_status path_phases "$PHASE_ID" completed
  expect_eq "and back again" "$(xp_total)" "$((BASELINE + 100))"
  echo
fi

echo "══ 5. Six toggles landing on PENDING — must net to zero ══"
if [ -z "${BASELINE:-}" ]; then
  echo "  SKIPPED — no phase available."
  echo
else
  # The test that separates the two models. Under the old permanent grant this read
  # BASELINE+100 no matter where the toggling stopped; the phase is not completed, so
  # holding its XP was the ledger describing a state that does not exist.
  for i in 1 2 3 4 5 6; do
    set_status path_phases "$PHASE_ID" completed
    set_status path_phases "$PHASE_ID" pending
  done
  expect_eq "six completions, landing on 'pending'" "$(xp_total)" "$BASELINE"
  echo "    (old model would have read $((BASELINE + 100)) here — permanent, regardless of final state)"

  # Put the borrowed row back exactly as it was found.
  set_status path_phases "$PHASE_ID" "$ORIG_STATUS"
  echo "  Restored phase to '$ORIG_STATUS'."
  echo
fi

echo "══ 6. Delete a completed row — its XP goes with it ══"
# Uses a throwaway goal this script creates, so nothing you care about is deleted.
DEL_BEFORE=$(xp_total)
TEMP_GOAL=$(curl -s -X POST "$URL/rest/v1/goals" "${auth[@]}" -H "Prefer: return=representation" \
  -d '{"title":"XP VERIFY — safe to delete","goal_type":"short_term","status":"active"}' \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

if [ -z "$TEMP_GOAL" ]; then
  echo "  SKIPPED — could not create the throwaway goal."
  echo
else
  echo "  Created throwaway goal $TEMP_GOAL"
  set_status goals "$TEMP_GOAL" completed
  expect_eq "completing it pays 250" "$(xp_total)" "$((DEL_BEFORE + 250))"

  curl -s -o /dev/null -X DELETE "$URL/rest/v1/goals?id=eq.$TEMP_GOAL" "${auth[@]}"
  expect_eq "deleting it takes the 250 back" "$(xp_total)" "$DEL_BEFORE"
  expect_eq "ledger rows for the deleted goal" \
    "$(curl -s "$URL/rest/v1/xp_events?select=id&source_id=eq.$TEMP_GOAL" "${auth[@]}" | grep -c '"id"' || true)" "0"
  echo "    (this is the delete-and-recreate faucet from 20260813130000 design note 3, closed)"
  echo
fi

echo "══ 7. NEGATIVE CONTROL — streak/habit proof XP never moved ══"
# Everything above proves XP can be taken away. This proves the taking-away cannot reach
# a proof grant. If this fails, revoke_xp()'s whitelist has a hole in it.
expect_eq "proof + habit_physical XP, before vs after everything" "$(proof_total)" "$PROOF_BEFORE"
probe "proof rows still present" "the same rows, untouched by any of the above" \
  "$URL/rest/v1/xp_events?select=source_type,amount,created_at&source_type=in.(proof,habit_physical)&order=created_at.desc&limit=5" "${auth[@]}"

rm -f /tmp/spartan_xp_body
echo "Done."
echo "Every probe in section 2 must be a 4xx."
echo "Sections 3-5: the toggles must all SUCCEED, and the total must track the final state."
echo "Section 7 is the one that must never fail: proof XP is permanent."
echo
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL ASSERTIONS PASSED"
else
  echo "$FAILURES ASSERTION(S) FAILED"
  exit 1
fi
