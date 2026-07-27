#!/usr/bin/env bash
# Phase 1 — prove a crafted client request cannot forge a streak or a squad.
#
# The catalog queries in verify_phase1.sql show what Postgres *will* enforce; this
# shows it actually refusing, using the same anon key and a real user JWT that the
# browser has. Nothing here is privileged — it is exactly what an attacker holding
# the (public) anon key and their own login could attempt.
#
# Usage:  ./verify_phase1_forgery.sh <username> <password>

set -euo pipefail
cd "$(dirname "$0")/.."

USERNAME="${1:?usage: verify_phase1_forgery.sh <username> <password>}"
PASSWORD="${2:?usage: verify_phase1_forgery.sh <username> <password>}"

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
  local code; code=$(curl -s -o /tmp/spartan_probe_body -w '%{http_code}' "$@")
  echo "  $desc"
  echo "    expect: $expect"
  echo "    got:    HTTP $code $(head -c 200 /tmp/spartan_probe_body)"
  echo
}

echo "── Baseline: the writes that SHOULD work ──"
probe "read own profile" "200 + one row" \
  "$URL/rest/v1/users?select=username,squad_id,current_streak&id=eq.$UID_" "${auth[@]}"
probe "rename self (the only granted column)" "204" \
  -X PATCH "$URL/rest/v1/users?id=eq.$UID_" "${auth[@]}" -d "{\"username\":\"$USERNAME\"}"

echo "── Forgery attempts: these MUST be refused ──"
probe "forge a 9999-day streak" "403 — permission denied for column current_streak" \
  -X PATCH "$URL/rest/v1/users?id=eq.$UID_" "${auth[@]}" -d '{"current_streak":9999}'
probe "backdate last check-in" "403 — permission denied for column last_checkin_date" \
  -X PATCH "$URL/rest/v1/users?id=eq.$UID_" "${auth[@]}" -d '{"last_checkin_date":"2020-01-01"}'
probe "jump into another squad by id" "403 — permission denied for column squad_id" \
  -X PATCH "$URL/rest/v1/users?id=eq.$UID_" "${auth[@]}" \
  -d '{"squad_id":"00000000-0000-0000-0000-000000000000"}'
probe "edit someone else's streak" "403, or 204 affecting 0 rows (RLS)" \
  -X PATCH "$URL/rest/v1/users?username=eq.someone_else" "${auth[@]}" -d '{"current_streak":9999}'
probe "create a squad directly, bypassing create_squad()" "403 — permission denied for table squads" \
  -X POST "$URL/rest/v1/squads" "${auth[@]}" -d '{"name":"Forged","join_code":"AAAAAA"}'
probe "rename own squad" "403 — permission denied for table squads" \
  -X PATCH "$URL/rest/v1/squads?join_code=neq.ZZZZZZ" "${auth[@]}" -d '{"name":"Renamed"}'
probe "delete own squad" "403 — permission denied for table squads" \
  -X DELETE "$URL/rest/v1/squads?join_code=neq.ZZZZZZ" "${auth[@]}"

echo "── Business rules inside the RPCs ──"
probe "join a second squad while already in one" "400 — 'You are already in a squad'" \
  -X POST "$URL/rest/v1/rpc/create_squad" "${auth[@]}" -d '{"p_name":"Second Squad"}'
probe "join with a bogus code" "400 — 'No squad found with that code'" \
  -X POST "$URL/rest/v1/rpc/join_squad" "${auth[@]}" -d '{"p_join_code":"ZZZZZZ"}'

rm -f /tmp/spartan_probe_body
echo "Done. Every forgery attempt above must be a 4xx."
