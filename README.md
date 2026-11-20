# Secret Hitler, online

A private, non-commercial web version of the board game **Secret Hitler** for 5–10 friends, each on their own phone or laptop. No accounts, no public lobby. It deploys to a **free Vercel Hobby** account and keeps its state in **Upstash Redis** (free tier).

- Next.js (App Router) + TypeScript + Tailwind, no component library, CSS-only animations
- All rules and randomness run **on the server**; browsers only send intents ("nominate X") and receive a filtered, per-player view
- Sync is cheap polling (no WebSockets, which Vercel functions can't hold)
- The card art is cropped from the colorized print-and-play PDF; the UI is laid out like those pieces

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
```

With no Redis environment variables, an **in-memory store** is used, so `npm run dev` works with zero setup. (It lives in one process and is lost on restart. That's fine for dev.)

### Playing a full game by yourself

Open the same room in several tabs of one browser. In **dev only**, `?as=<name>` gives each tab its own seat:

1. `http://localhost:3000/?as=ann` → enter a name, **Create room** (you get a code, say `KXPD`)
2. `http://localhost:3000/KXPD?as=ben`, `?as=cy`, `?as=di`, `?as=ed` → each joins automatically with that name
3. In the first tab press **Start**, then play every seat

`?as=` is ignored in production builds. Without it, each browser profile or device is one seat, and refreshing or closing the tab reconnects you to the same seat (a secret token lives in `localStorage`, keyed by room code).

### Tests

```bash
npm test             # engine, view filter, stores, API routes, 360 simulated games
npm run typecheck
npm run build
```

If a `redis-server` binary is on your `PATH`, the store and API suites also run the Lua scripts against a **real Redis** (via a tiny Upstash-protocol shim in `tests/redis-shim.ts`); otherwise those parts are skipped.

## Deploy to Vercel (free)

1. Push this repo to GitHub and **Add New → Project** in Vercel, importing it (framework: Next.js, no settings to change).
2. In the Vercel project, open **Storage** (or the **Marketplace**), pick **Upstash → Redis**, create a free database and **connect it to the project** for Production (and Preview if you like).
3. The integration injects the environment variables for you. Either naming works:

   | Variable | Alternative name |
   |---|---|
   | `KV_REST_API_URL` | `UPSTASH_REDIS_REST_URL` |
   | `KV_REST_API_TOKEN` | `UPSTASH_REDIS_REST_TOKEN` |

   Other variables the integration adds (`KV_URL`, `REDIS_URL`, read-only token) are not used.
4. **Redeploy** so the new variables are picked up. Open the site, create a room, send the link to friends.

Tip: create the Upstash database in the region nearest to your Vercel Functions region (Hobby defaults to Washington, D.C. / `iad1`) to keep each Redis round trip short.

If Redis variables are missing on Vercel the API answers with a clear error instead of silently using memory (serverless instances don't share memory).

## How it works

```
browser ──GET /api/room/CODE/version?p=me──▶ { v, idle[] }          every ~1.5 s (5 s in lobby / game over)
        ──GET /api/room/CODE/state ────────▶ your personalised view  only when v changed
        ──POST /api/room/CODE/action ──────▶ your new view           your own actions
```

- **Source of truth:** one JSON document per room in Redis (`sh:room:CODE:s`) plus a small hash (`sh:room:CODE:m`) holding the `version` and each player's last-seen time. Both expire 24 h after the last write.
- **Atomic writes:** every change is a Lua `EVAL` that does compare-and-set on `version`; on a conflict (two players acting in the same instant) the server reloads, re-applies the rules to the fresh state and retries. Simultaneous votes are all counted (covered by tests, against a real Redis).
- **Cheap polls:** a poll is one `EVAL` that returns the version and everyone's last-seen time. Polling pauses while the tab is hidden. A short per-instance micro-cache lets simultaneous polls for one room on the same serverless instance share a single Redis call.
- **Presence:** players not seen for ~20 s are dimmed. Nobody is ever skipped automatically.
- **Hidden information:** `getPlayerView(room, playerId)` in `lib/game/view.ts` is the only thing that builds a payload. It is an allow-list: no tokens, no deck or discard contents (counts only), no other roles (except what the rules reveal, and everything at game over), ballots only once everyone has voted, hands only to the player holding them, investigation results (Party Membership, never the role) and Policy Peek cards only to the President. `tests/view.test.ts` checks this *differentially*: it changes everything a player must not know and requires their view to stay byte-identical.

### Redis command budget

Free Upstash plans count commands per month (check the current limit on their pricing page; it was 500 K/month when this was written). Per hour of play with 8 players, expect roughly **5–17 thousand Redis commands** (the low end when polls share a serverless instance and its micro-cache, the high end when they don't), plus about two commands per action. A few game nights a week fit comfortably.

Every poll is also a Vercel **function invocation** (about 2,000 per player-hour, so ~16 K per hour for 8 players). Check the current Hobby limits on Vercel's pricing page; at 1 M invocations/month that's roughly 60 hours of 8-player play, far more than a few game nights a week. Pausing hidden tabs and the 5 s lobby / game-over cadence keep it down.

## Rules: decisions where the rulebook is silent

Implemented from `Secret_Hitler_Rules.pdf`. Where it doesn't say, this build chooses:

- **Execution, Investigate Loyalty and Special Election can't target yourself.**
- The colorized board prints **four** Election Tracker circles (three "Fail" arrows, then "Reveal & pass top policy"), so the tracker is drawn that way, with the marker on the number of failed governments.
- The draw pile is reshuffled whenever fewer than 3 tiles remain after a legislative session, a veto, or before a chaos draw. The discard pile is shuffled in, never stacked on top.
- Everything in the log is public: nominations, each player's vote, enacted policies, who was investigated or executed. Discards, hands, peeks and investigation results never appear.
- The president picks "Done" after an investigation or a peek so the result stays on screen until they've looked.

## Card art

`scripts/extract-assets.py` regenerates `public/cards/*.webp` from the PDFs:

```bash
pip install -r scripts/requirements.txt     # plus poppler-utils for pdfimages / pdftoppm
python3 scripts/extract-assets.py "Secret_Hitler_-_Print_and_Play_-_Color_-_A4_Scaled_-_with_Rules.pdf" "Secret_Hitler_Rules.pdf"
```

The first eight pages of the colorized PDF are 300 ppi rasters, so the art is cut out of those pixels (cards by connected components, the hollow Party Membership cards by their printed cut-line grid), rotated upright, and given transparent rounded corners with the printed frames intact. The printed sheets repeat identical cards (6 Liberal roles, 3 Fascist roles, ...), so one of each is exported. Power icons and the team emblems are keyed out of the board art. The wordmark and the sword-and-olive emblem come from the rulebook cover. **There is no card back in the PDFs**, so `card-back` / `tile-back` are built in the script from the Ja! ballot's double-line frame plus that emblem.

## Attribution and license

*Secret Hitler* is by Mike Boxleiter, Tommy Maranges and Mac Schubert (**Goat, Wolf & Cabbage**) and is licensed **CC BY-NC-SA 4.0**: <https://secrethitler.com>, <https://creativecommons.org/licenses/by-nc-sa/4.0/>. This is an unofficial, non-commercial fan build and the footer on every page credits the game and links the license.

Changes: the card, tile, ballot, placard and board art was cropped, rotated, given transparent corners or keyed to transparency (Party Membership, role, policy, ballot, placard and icon artwork are otherwise unaltered); two card backs were composed from the printed frame and emblem; the board is redrawn in HTML/CSS using the printed layout; everything else is new code.

Because it adapts the game's artwork, redistribute this repository only under the same license (BY-NC-SA 4.0), non-commercially, and keep the footer credit. The license also forbids submitting anything built from the game to an app store.
