# comfort-letters/ — 퇴근길 빡침 우체통 (Vercel + Supabase)

## Purpose
An anonymous venting messenger. There is no signup: a user joins with just a nickname.
- **Broadcast rooms (2026-11-05 redesign):** a **seeker** (위로받는 사람) does not pick anyone. Each "쏟아내기" creates a new **room** owned by the seeker (`cb_threads.comforter_id IS NULL`). Every registered **comforter** (편들어 주는 사람, any `cb_comforters` row) sees the broadcast rooms **created after their own account was created** in "받은 하소연" and can reply. It is a group chat: everyone in the room sees every reply.
- Rooms accumulate per seeker in the seeker's "내 하소연 방" list. Only the seeker can close a room; history stays.
- Legacy 1:1 threads (`comforter_id` not null) from the old design are still readable by their two participants only.
- A comforter registers with a one-line intro and can pause (active=false). Paused comforters still see rooms; `active` only affects the "N명이 준비 중" count.
- Identity is a random bearer "key" (열쇠) stored in localStorage. The server stores only its SHA-256 hash.
- When crisis keywords are detected, the app shows the 109 and 1577-0199 hotline numbers. It does not block sending.
- **2026-11-06 additions** (migration `20261106000000_safety_and_prefs.sql`, additive only): report & block, profile emoji, message recall, read receipts ("읽음 N" → popup of readers), per-room hide / "편들어 주기 그만" with a status line in the room header, per-room drafts, browser notifications while the tab is open (no Web Push yet), empty-reply hint, taller mobile composer.

## Files
- `package.json`: ESM, node>=20, `@supabase/supabase-js`, devDependency `supabase` (the CLI). **No npm scripts.**
- `vercel.json`:
  - cleanUrls, region `icn1`.
  - Security headers for all paths: nosniff, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`.
  - `X-Robots-Tag: noindex` on `/api/*`.
  - No rewrites. `api/*.js` is auto-detected, and `public/` is the static root.
- `setup.ps1`: one-time setup that was already run (setup.log shows "tables: OK / key: OK"):
  1. `npx supabase link --project-ref <hardcoded>`
  2. Prompts for the DB password, then runs `npx supabase db push --remote --yes`.
  3. `npx supabase projects api-keys --reveal -o json` → picks the `sb_secret_*` key, or else the service_role key.
  4. `vercel env add SUPABASE_SERVICE_ROLE_KEY production --sensitive --force`. This is **production only**.
  - `SUPABASE_URL` is not set by this script; it was already in Vercel.
- `.env.local`: contains only `VERCEL_OIDC_TOKEN`, so there is no Supabase configuration for local dev.
- `.vercelignore`: supabase, *.ps1, *.log, .env*.
- `supabase/config.toml`: default init config. The `seed.sql` it references does not exist.

## Run / deploy
- `npm install`
- Local: `vercel dev`. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be set by hand, otherwise every API call returns 500.
- Deploy: `vercel --prod`. The project is already linked through `.vercel/project.json`.

## lib/common.js
| Export | Behavior |
|---|---|
| `db()` (6-14) | Service-role Supabase singleton. **Bypasses RLS.** |
| `Invalid(msg, code=400)` | User-facing error |
| `send(res, code, body)` | JSON response with no-store and nosniff headers |
| `handle(fn)` (27-35) | Turns `Invalid` into `{error}`; anything else becomes a 500 with a Korean generic message |
| `body(req)` | Requires a plain JSON object |
| `text(v,{min,max,label})` | Converts CRLF to LF, trims, and checks UTF-16 length |
| `isUuid` | `/^[0-9a-f-]{36}$/i` (loose) |
| `newToken()` / `hashToken()` | 24 random bytes as base64url / SHA-256 hex |
| `currentUser(req,{required})` (61-77) | Bearer `[A-Za-z0-9_-]{20,64}` → hash → per-instance 60-second cache → `cb_users` lookup. Returns 401 when missing or wrong |
| `forgetUser(hash)` | Evicts the cache entry on this instance only |
| `checkRate(userId)` | 20 or more messages per minute, or 500 or more per day, gives 429 |
| `EMOJIS` / `emoji(v)` | Allowed profile emoji: 40 diverse **people** emojis (genders, ages, jobs, skin tones; some are ZWJ sequences, all ≤16 UTF-16 units). `emoji(undefined)` → undefined (leave as is); `""` clears; anything else not in the list → 400 "고를 수 있는 이모티콘이 아니에요." The same list is duplicated in `public/start.html` and `public/index.html`. |

`currentUser` selects `id, nickname, emoji, created_at` (cached 60s per instance).

## lib/rooms.js
| Export | Behavior |
|---|---|
| `isComforter(id)` | any `cb_comforters` row |
| `blockedSet(id)` | Set of user ids in a block relation with the caller, **both directions** |
| `prefsFor(id, threadIds)` / `setPref(tid, uid, patch)` | read / upsert `cb_room_prefs` (`hidden_at`, `stopped`) |
| `canView(t, user, comforter, blocked)` | owner always; seeker in `blocked` → no; broadcast → comforter && room made after the caller's account && `!t.moderated`; legacy → named comforter |
| `loadRoom(id, user)` | → `{t, comforter, blocked}` or 404 "방을 찾을 수 없어요." |
| `postMessage(...)` | insert + `cb_threads.last_*` + author's `cb_reads` |
| `RECALLED` / `MODERATED` / `BLOCKED_LAST` | placeholder strings |

## API (all JSON; any other method gets 405)
- **/api/me**
  - GET: returns the profile `{id, nickname, emoji, comforter:{intro,active}|null}`.
  - POST `{nickname, emoji?}` (1-20 chars), no auth: returns 201 `{token,...}`. **This is the only time the raw key is returned.**
  - PATCH `{nickname?, emoji?}`: updates either; neither → 400 "닉네임을(를) 적어 주세요.".
  - DELETE: deletes `cb_users`. The cascade wipes the comforter row, the threads and the messages, including the other party's copies.
- **/api/comforters**
  - GET (auth optional): active comforters (up to 200), excluding the caller. Returns `[{id,nickname,intro,letters}]`. `letters` is the number of **threads** (the code comment says messages, which is wrong).
  - POST `{intro≤100, active}`: upserts the caller's comforter row.
- **/api/rooms** (`api/rooms.js`; replaced the old `threads.js`)
  - GET: `{comforter, mine:[…], others:[…], hidden:[…]}`. `mine` = rooms where caller is seeker (≤100). `others` = broadcast rooms of other seekers if caller is a comforter (≤100, not `moderated`, created after the caller's account, seeker not in `blockedSet`) + legacy 1:1 threads where caller is the comforter (≤50). Rooms the caller stopped, or hid with no newer activity (`updated_at <= hidden_at`), move to `hidden` with `kind: "mine"|"others"`. Each item: `{id, title, seeker, seeker_emoji, seeker_id, legacy, closed, updated_at, last:{text,mine,author}|null, unread, stopped, hidden}`. `unread` = `last_id > cb_reads.last_read_id`, last author ≠ caller and not blocked. If the last author is blocked, `last.text` is "(차단한 사람의 메시지)".
  - POST `{body≤2000}`: creates a broadcast room + first message. Returns 201 `{id, reach}` (`reach` = active comforters excluding caller). Rolls back the room if the message insert fails (not transactional).
- **/api/room?id=** (`api/room.js`; replaced `thread.js`)
  - Access: `lib/rooms.js canView` (see above). Otherwise 404.
  - GET `&after=msgId`: `{id, title, seeker, seeker_emoji, seeker_id, owner, legacy, closed, moderated, stopped, hidden, participants, messages, removed, readers}`.
    - `messages` (≤1000, after `after`, blocked authors filtered out): `{id, mine, author, author_emoji, author_id, by_seeker, body, at, removed}`; `removed` is `"recalled"`/`"moderated"`/null and `body` is "" when removed.
    - `removed`: **all** recalled/moderated ids in the room every time, so pollers update bubbles they already have.
    - `readers`: everyone else's `cb_reads` (blocked excluded) as `{name, emoji, last_read_id}`; the client counts readers of message M as `last_read_id >= M`.
    - `participants`: distinct non-seeker authors.
    - **Side effect:** upserts the caller's `cb_reads` to the room's `last_id`.
  - POST `{body}`: 400 if closed or if the caller `stopped` this room; rate-limited; returns 201 message view.
  - PATCH `{action}`: `close` (default when no body; seeker only, legacy: either participant, else 403) · `hide` / `unhide` (anyone) · `stop` / `resume` (non-owners; owner → 400). Returns `{ok, hidden, stopped}` for prefs. Unknown action → 400.
- **/api/message?id=** (`api/message.js`) — DELETE only: author recalls own message → `deleted_at=now`, `body=''` (content is not kept); if it was the room's last message, `last_body` becomes "(회수된 메시지)". Someone else's / unknown / non-numeric id → 404. Already recalled → `{ok, already:true}`.
- **/api/reactions** (`api/reactions.js`) — POST `{message_id, emoji}` toggles the caller's reaction (`REACTIONS` = 👍 😢 🔥 😡 🫂 💪 in `lib/rooms.js`). Room must be viewable (404); recalled/moderated message or blocked author → 400 "반응할 수 없는 메시지예요."; unknown emoji 400. Returns `{message_id, on, reactions:[{emoji,count,mine}]}`. Room GET also returns `reactions: {messageId: [...]}` for the **whole room** every poll (`summarizeReactions`, blocked users excluded, ≤5000 rows).
- **/api/blocks** — GET list `[{id, nickname, emoji, created_at}]`; POST `{user_id}` (self 400, unknown 404, idempotent upsert); DELETE `?user_id=`.
- **/api/reports** — POST `{thread_id, message_id?, reason: abuse|spam|privacy|sexual|other, detail≤300, block?}`. Room must be viewable (404); message must be in that room (404); reporting yourself 400; one report per reporter per message (or per room) → 409. **3 distinct reporters** → message `moderated=true` (or room `moderated=true`, hiding it from other comforters). `block:true` also blocks the target. Returns 201 `{ok, hidden, blocked}`. Reports are reviewed in the Supabase dashboard (`cb_reports`); there is no admin UI.

## DB (`supabase/migrations/20261105100000_comfort_letters.sql`)
- `cb_users`: id uuid, `token_hash` unique, nickname 1-20, created_at.
- `cb_comforters`: user_id PK and FK (cascade), intro ≤100, active.
- `cb_threads`:
  - Columns: id, seeker_id, comforter_id, seeker_unread, comforter_unread, closed, created_at, updated_at.
  - Constraint: seeker ≠ comforter.
  - Indexes on (seeker_id, updated_at desc) and (comforter_id, updated_at desc).
- `cb_messages`:
  - Columns: id bigint identity, thread_id, author_id, body 1-2000, created_at.
  - Indexes on (thread_id, id) and (author_id, created_at desc).
- `20261105200000_broadcast_rooms.sql` (applied 2026-11-05 via `migrate.ps1`):
  - `cb_threads.comforter_id` nullable (null = broadcast room). New columns `title` (first 40 chars), `last_id`, `last_body` (≤120), `last_author` — denormalized for the sidebar; backfilled from existing messages.
  - Partial index on `updated_at desc where comforter_id is null`.
  - `cb_reads(thread_id, user_id, last_read_id)` PK (thread_id,user_id): per-user read position. The old `seeker_unread`/`comforter_unread` columns are no longer used.
- `20261106000000_safety_and_prefs.sql` (applied 2026-11-06; **additive only**, no rows changed):
  - `cb_users.emoji` text default '' (≤16 chars).
  - `cb_messages.deleted_at`, `cb_messages.moderated`; `cb_messages_body_check` relaxed to `deleted_at is not null or 1..2000` so recalled messages can have an empty body.
  - `cb_threads.moderated`.
  - `cb_blocks(blocker_id, blocked_id)` PK, cascade, no self-block.
  - `cb_reports(id identity, reporter_id → set null, target_user_id, thread_id, message_id → cascade, reason check, detail ≤300)`, unique `(reporter_id, thread_id, coalesce(message_id,0))`.
  - `cb_room_prefs(thread_id, user_id)` PK with `hidden_at`, `stopped`.
- `20261106100000_reactions.sql` (applied 2026-11-06; additive): `cb_reactions(message_id → cb_messages cascade, thread_id → cb_threads cascade, user_id → cb_users cascade, emoji ≤8, created_at)` PK `(message_id, user_id, emoji)`, index on `thread_id`.
- RLS is enabled with **no policies**, and all privileges are revoked from anon/authenticated. Only the service role can access the tables.
- `updated_at` is maintained by app code. There are no triggers.
- `20261105000000_responses.sql` belongs to the survey-vercel app, which shares the same Supabase project. **Do not delete it:** the migration history has to stay in sync.

## Frontend
- Storage:
  - localStorage `comfort-letters-key`: the current raw token.
  - localStorage `comfort-letters-accounts`: `[{token, nickname, id?, me?}]` — accounts registered in this browser.
  - sessionStorage `comfort-letters-session`: the token chosen in this tab. **index.html redirects to `/start` unless it equals the current key**, so every new tab/window starts at the account picker.
- **start.html** (entry point):
  - No stored accounts → registration form only ("처음이네요").
  - Stored accounts → "누구로 들어갈까요?" picker (enter / 빼기 per account) + "새 닉네임 등록" toggle. `?add=1` opens the form directly.
  - Key import, validated with GET /api/me. All paths call `enter(tok)` → sets key + session → `/#/`.
- **index.html**: two-column messenger. Left `aside.side` (300px): account box (계정 바꾸기 → /start), "＋ 새로 쏟아내기", "내 하소연 방" and "받은 하소연" room lists with unread badges, menu (편들어 주기 설정, 내 정보), hotline. Right `main.main` views by hash:
  - `#/` home (welcome) · `#/new` compose (shows reach count from GET /api/comforters) · `#/r/<uuid>` room · `#/give` · `#/me`.
  - ≤760px: single column; `body[data-pane]` toggles sidebar vs main, with a ‹ back link.
  - Room: group bubbles (name shown when the author changes, seeker tagged "하소연"), polls every 3s with `after=lastId`, optimistic pending bubble with retry, Enter sends / Shift+Enter newline (IME-safe). Seeker sees "방 닫기".
  - Room list polls every 8s (also while the tab is in the background, for notifications). Rooms whose `seeker_id` is any of this browser's accounts are hidden from "받은 하소연" (`myIds()`; ids are back-filled by `fillAccountIds()`). A collapsible "숨긴 방 · 그만둔 방" section lists `hidden`.
  - Room header: emoji avatar, title, status chips (진행 중/닫힘, 편들어 준 사람 N명, 그만둠, 숨김, 신고로 가려짐) and a top-right **⋯ menu**: hide/unhide, "편들어 주기 그만"/"다시 편들기" (non-owners), report / block the seeker (non-owners), close (owner).
  - Click a bubble → menu: own message = 회수; others = 신고 / 차단; plus copy. Report uses a `<dialog>` (reason, detail, "차단도 하기" checked by default).
  - Own bubbles show "읽음 N" (button → `<dialog>` listing readers) or "안 읽음".
  - Drafts: localStorage `comfort-letters-draft:<token first 12>:<roomId|new>`, saved on input and when switching rooms, cleared on send.
  - Notifications: sidebar toggle; localStorage `comfort-letters-notify`="1" + `Notification.permission`. Only while a tab is open; there is no Service Worker / Web Push.
  - Empty send in a room shows "뭐라도 적어요. 한 줄이면 돼요." Composer textarea is 16px font, min-height 48px (64px on ≤760px) with safe-area padding.
  - Short windows: the room header, composer and closed-note are `flex: none` (only `.log` shrinks, min 80px). At `max-height: 560px` the whole sidebar scrolls as one (`aside.side` overflow auto, `.lists` not separately scrolled) so the room lists don't collapse; taller windows keep the menu pinned at the bottom with only `.lists` scrolling.
  - `#/me`: nickname, emoji picker (PATCH emoji), blocked list with 차단 풀기, key, remove/wipe.
  - ≤760px: the ‹ back links were replaced by a **☰ button** in every main-view header; it opens the sidebar as an overlay drawer (`body.drawer`, backdrop `#drawerBack`, closes on Esc / backdrop / navigation). The room ⋯ menu stays in the room header.
  - **Emoji pad**: 🙂 button next to the room input and the 쏟아내기 textarea opens `#emojiPad` (48 common emoji) and inserts at the caret (fires `input`, so drafts/counters update).
  - **Reactions**: the bubble menu starts with a reaction bar (6 emoji); chips under each bubble show `emoji count` (mine highlighted) and toggle on click; redrawn from `reactions` on every poll.
- start.html: registration form has an emoji picker (radio buttons; "없음" default); stored accounts show their emoji. Each stored account row has an **"이모지" button** that opens a picker and PATCHes `/api/me` with that account's token before entering.
- Rendering uses textContent only (no innerHTML).

## Gotchas / known bugs
1. (Fixed by the rooms redesign: the sidebar now reads denormalized `cb_threads.last_*` instead of scanning messages.)
2. Creating a room and its first message is not transactional (best-effort rollback in `api/rooms.js`). `last_*` updates are last-writer-wins under concurrent posts.
2a. (Changed 2026-11-05) A comforter only sees broadcast rooms whose `created_at` ≥ **their account's** `cb_users.created_at` (`api/rooms.js` `.gte`, `lib/rooms.js madeAfterJoin`; older rooms → 404). It is the account creation time, not the comforter-registration time. Legacy 1:1 threads addressed to them stay visible regardless of age. Paused comforters can still read and reply. `currentUser` now selects `created_at` too.
3. `checkRate` is not atomic. `POST /api/me` has no rate limit.
4. The user cache is per instance, so a deleted token can stay valid on other instances for up to 60 seconds.
5. (Removed: there is no comforter picker any more.)
6. `migrate.ps1` (interactive, DB password) applies new migrations; it writes `migrate.log` without secrets.
7. (Fixed 2026-11-06, security V-11) `isUuid` is now the exact 8-4-4-4-12 hex pattern, so malformed ids get 404 instead of reaching Postgres.
7a. Security fixes 2026-11-06 (report: `comfort-letters/보안점검/2026-11-06_소스보안점검결과서.md`): `lib/rooms.js scrubTraces(t, msgId, placeholder)` replaces `title` (if it was the first message) and `last_body` (if it was the last) on recall (`RECALLED`) and on report auto-hide (`MODERATED`); `recomputeLast(threadIds)` rebuilds `last_*` for other people's rooms after `DELETE /api/me`; `cut(s,n)` cuts by code point; `positiveId()` accepts only `^\d{1,15}$` (used by message/reactions/reports); `text()` rejects non-string values ("<label> 형식이 올바르지 않아요."); `stripInvisible()` removes U+200B/200E/200F/202A-202E/2060-2064/2066-2069/FEFF from nicknames (ZWJ kept); reports use `Object.hasOwn(REASONS, …)`.
7c. Security V-01/V-02 (2026-11-06, migration `20261106200000_abuse_limits_admin.sql`, additive): `POST /api/me` limits **20 sign-ups per IP per 24h** (`clientIp` = first `x-forwarded-for` hop; only `ipHash` = HMAC-SHA256(service key) stored in `cb_signup_log`; rows older than 2 days pruned on each sign-up; no IP header → no limit). `POST /api/rooms` limits **10 rooms per account per 24h** (429). Reports **no longer auto-hide** anything (`api/reports.js` returns `{ok, blocked}`). Moderation moved to **`/admin`** (`public/admin.html`, noindex/no-store) + **`api/admin.js`**: header `x-admin-password` must match Vercel env `ADMIN_PASSWORD` (set via `admin-password.ps1`; 503 if unset, 401 + 1s delay if wrong). GET `?status=open|all` lists reports (≤200) with reporter/target nicknames, room and message; POST `{action}`: `hide_message` / `unhide_message` (restores title & preview) / `hide_room` / `unhide_room` / `resolve` / `reopen` (`cb_reports.reviewed_at`). `REASONS` moved to `lib/rooms.js`.
7b. Open items from the security review (not fixed yet): report evidence lost on recall/delete (V-04), read-receipt and user-id exposure (V-05), raw keys of all accounts in localStorage and no key rotation (V-06), no CSP / Permissions-Policy (V-08), cannot recall own message after being blocked (V-09), polling cost (V-12).
8. The service key is set only for production, so preview deployments and `vercel dev` fail.
9. `GET /api/comforters` is public, so anyone can list active comforters' nicknames and intros.
