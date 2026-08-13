#!/usr/bin/env bash
# Avatars + username — prove the profile fields are only writable by their owner.
#
# `users` hands the browser UPDATE on exactly two columns (username, avatar_path) and the
# `avatars` bucket is private with owner-only writes. Both claims are checked here with a
# real user JWT and the public anon key — nothing privileged.
#
# The interesting probes are the last two: RLS on `users` is what stops you renaming
# somebody else through a grant you legitimately hold, and the storage INSERT policy is
# what stops you writing into another user's avatar folder.
#
# Usage:  ./verify_avatar_forgery.sh <username> <password>

set -euo pipefail
cd "$(dirname "$0")/.."

USERNAME="${1:?usage: verify_avatar_forgery.sh <username> <password>}"
PASSWORD="${2:?usage: verify_avatar_forgery.sh <username> <password>}"

URL=$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2-)
KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2-)

LOGIN=$(curl -s "$URL/auth/v1/token?grant_type=password" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"${USERNAME}@spartans.local\",\"password\":\"${PASSWORD}\"}")

TOKEN=$(printf '%s' "$LOGIN" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4 || true)
UID_=$(printf '%s' "$LOGIN" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
[ -n "$TOKEN" ] || { echo "Sign-in failed:"; echo "$LOGIN"; exit 1; }
echo "Signed in as $USERNAME ($UID_)"; echo

auth=(-H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
OTHER="00000000-0000-0000-0000-000000000000"

probe() {
  local desc="$1" expect="$2"; shift 2
  local code; code=$(curl -s -o /tmp/spartan_av -w '%{http_code}' "$@")
  echo "  $desc"; echo "    expect: $expect"; echo "    got:    HTTP $code $(head -c 200 /tmp/spartan_av)"; echo
}

echo "══ 1. The two columns you SHOULD be able to write ══"
probe "rename self to the same name (no-op)" "204" \
  -X PATCH "$URL/rest/v1/users?id=eq.$UID_" "${auth[@]}" -d "{\"username\":\"$USERNAME\"}"
probe "clear own avatar_path" "204" \
  -X PATCH "$URL/rest/v1/users?id=eq.$UID_" "${auth[@]}" -d '{"avatar_path":null}'

echo "══ 2. Columns the grant must NOT cover ══"
probe "give self a 9999 streak" "403 — permission denied for column current_streak" \
  -X PATCH "$URL/rest/v1/users?id=eq.$UID_" "${auth[@]}" -d '{"current_streak":9999}'
probe "move self into another squad" "403 — permission denied for column squad_id" \
  -X PATCH "$URL/rest/v1/users?id=eq.$UID_" "${auth[@]}" -d "{\"squad_id\":\"$OTHER\"}"

echo "══ 3. RLS — the grant is yours, the row is not ══"
probe "rename a DIFFERENT user" "204 affecting 0 rows (RLS matched nothing)" \
  -X PATCH "$URL/rest/v1/users?id=neq.$UID_" "${auth[@]}" -d '{"username":"pwned"}'
echo "    ^ then confirm nobody was actually renamed:"
probe "anyone now called 'pwned'?" "200 with [] — nothing was renamed" \
  "$URL/rest/v1/users?select=id,username&username=eq.pwned" "${auth[@]}"

echo "══ 4. Storage — you may only write your own folder ══"
printf 'not-really-an-image' > /tmp/spartan_fake.png

probe "upload into ANOTHER user's avatar folder" "400/403 — new row violates row-level security" \
  -X POST "$URL/storage/v1/object/avatars/$OTHER/avatar" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: image/png" \
  --data-binary @/tmp/spartan_fake.png

probe "upload to the bucket root, outside any folder" "400/403 — policy requires a uuid folder" \
  -X POST "$URL/storage/v1/object/avatars/avatar" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: image/png" \
  --data-binary @/tmp/spartan_fake.png

probe "delete ANOTHER user's avatar" "400/403/404 — never 200" \
  -X DELETE "$URL/storage/v1/object/avatars/$OTHER/avatar" "${auth[@]}"

echo "  NOTE: the bucket also caps uploads at 2 MB and rejects non-image mime types"
echo "        server-side. Try a 5 MB file through the Settings modal to see that path."
echo

rm -f /tmp/spartan_av /tmp/spartan_fake.png
echo "Done. Sections 2, 3 and 4 must all be refusals (or 0 rows affected)."
