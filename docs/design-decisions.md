# Design Decisions

Status: **firm direction, not locked in code.** This captures decisions made during early
planning so they aren't re-litigated. Anything here can still change before implementation,
but changing it should be a deliberate call, not drift.

Last updated: 2026-08-30 (§4 annual-reset decision firmed)

---

## 1. The game, in one paragraph

A play-money stock market on real golfers. Users ("investors") start with a fixed pot of
in-game currency and build a portfolio of player shares. Players earn **dividends** based on
tournament finishing position (FedEx Cup points ÷ a divisor). Share prices are set by a
market of investors trading with each other. The season runs alongside the real golf
calendar; at season end all shares are liquidated and the investor with the most currency
wins. Weekly/monthly sub-competitions and private friend groups keep engagement between
majors.

Lineage: this is a port of a ~2019 beach-volleyball design (original PDFs in
`reference/`). Core mechanics carry over; the sport does not.

---

## 2. Sport: golf (pivot from beach volleyball)

**Decision: build a golf-focused game.**

Why golf over volleyball or tennis:

- **Audience.** Golf's overlap with the fantasy/DFS/finance-game demographic is large and
  established (golf DFS is a mature category). Beach volleyball's fan base is too small to
  reliably get hundreds of concurrent traders around an event. Tennis has a bigger global
  audience but it's more diffuse and less concentrated in the finance-game crowd and in
  favorable time zones.
- **Schedule quality.** Golf tee times and draws are published days in advance and are
  extremely reliable — ideal for the schedule-driven market freeze (see §5).
- **Cadence.** A full PGA Tour season is ~35+ events, near-continuous weekly play. This
  matters for retention: a majors-only game (4 events/year) produces sign-up → good
  experience → total disengagement before the next one. A weekly drumbeat gives players a
  reason to keep opening the app.
- **Field depth = real market.** With concurrent events (a strong-field signature event and
  a weak-field opposite-field event the same week), lower-ranked players in weak fields have
  genuine dividend upside. This is where "I found value nobody else saw" gameplay lives. A
  majors-only game funnels all money into ~20 elite names and kills that.

Trade-off accepted: golf has **no bracket**. The volleyball/tennis "player eliminated → pay
dividend → return to market" model becomes, for golf, just two events per tournament — **the
cut** (after round 2) and **the finish** (Sunday). Fewer freeze/settle cycles, simpler
engine, but the "live sweat / value-buy while my player is losing" texture is weaker. Judged
an acceptable loss for a finance-flavored game (see §6).

---

## 3. Dividends: FedEx Cup points, with a translation table for non-FedEx events

**Base rule:** dividend per share = f(FedEx Cup points earned for finishing position).
Divisor TBD (volleyball used points ÷ 10; golf's scale is different — needs calibration so
yields feel right relative to share prices).

**Events that need no translation:** all PGA Tour events (regular, signature, majors, The
Players) award FedEx Cup points directly on published finish-position tables.

**Events that need a points translation:**

- DP World Tour events (award Race to Dubai points, different scale)
- Opposite-field / limited-field PGA events (already reduced FedEx scale — partially handled)
- Any other covered tour/event without native FedEx points
- **LIV: excluded.** No OWGR/FedEx points, politically messy.

**Translation approach:**

- **Launch: a fixed tier table.** Bucket every covered event into tiers (major / signature /
  full-points PGA / reduced-points PGA / DP World flagship / DP World standard) and assign
  each tier a points pool distributed on a standard finish curve. Transparent, explainable,
  shippable. Crude — ignores week-to-week field strength.
- **Later: strength-of-field formula.** Compute a field-strength score (e.g. sum of field
  OWGR points) and map it to an equivalent FedEx points pool, then distribute by finish.
  This is roughly what OWGR itself does; makes any event with a known field defensible.

The tier table also **is the coverage decision** — tiers below a chosen line are simply
"not in the market."

---

## 4. Season calendar

The golf year is **not** a clean Jan–Dec continuous season.

- **Main season: early January → late August.** Starts at The Sentry (first week of Jan).
  Ends at the **Tour Championship** (late Aug) — FedEx Cup finale, ~35 covered events, a
  natural season-long narrative (the FedEx Cup race). **Full portfolio liquidation here;
  season winner declared.** (Mirrors the volleyball design's "season start → World Tour
  Finals".)
- **Majors** all fall inside that window: Masters (Apr), PGA Championship (May), US Open
  (Jun), The Open (Jul).
- **Shoulder season: September → mid-November.** PGA "FedEx Cup Fall" (reduced points,
  championship already decided) + DP World Tour run-in to the Race to Dubai (DP World Tour
  Championship, Dubai, mid-Nov). Something tradeable most weeks, lower stakes. Candidate for
  a separate mini-competition; **does not count toward the main season title** and does not
  survive the January reset (see annual-reset decision below).
- **Off-season: mid-November → end of December.** ~6 weeks, essentially no meaningful golf.
  This is the real gap. The market is **closed** during this window — no trading, no covered
  events. Remaining option (not yet decided): whether to run an off-season prediction
  side-game during the gap.

**Decision: hard annual reset.** Each season is a self-contained competition, Sentry (early
Jan) → Tour Championship (late Aug), with exactly one winner.

- At the Tour Championship: full portfolio liquidation, final rankings, season winner
  declared. All shares cease to exist.
- Each January every investor starts **fully identical** — same fixed starting pot, zero
  score, no carryover of any kind. Starting cash is **not** scaled by prior-season finish.
- The **entire field re-IPOs** in January. No player carries a price, float, or history
  across the reset. Prior seasons are bragging rights only.
- Consequences: no "hold a player across the off-season" edge cases; no stale prices to
  manage during the 4-month gap; the IPO share-count formula only handles the annual bulk
  re-IPO plus mid-season new entrants, never a continuous rolling market.

**Player share model across tours:** one global share per player. A player's *status*
(`active` / `in_market` / `not_in_market`) depends on whether they're teed up in a covered
event that week. A player who plays PGA one week and DP World the next stays continuously in
the market. Good for liquidity and for the "hold him across events" gameplay.

---

## 5. Market states and the schedule-driven freeze

**Player market states:**

| State | Trading |
|---|---|
| `not_in_market` | none — player not in a covered event |
| `ipo` | buy-only at fixed IPO price; no secondary trading |
| `open` | full trading (order book; see §6) |
| `frozen` | no trading; resting orders held |

**The freeze rule (key anti-manipulation decision):**

While a player is playing a round in the real world, their market is **frozen**. It reopens
to `open` only after the round's result has been ingested and any cut/finish
dividend/settlement has processed.

- Freeze is triggered by the **published schedule** (tee times), via a cron job — **not** by
  the results feed detecting that play has started. If the draw says the player tees off at
  14:00, freeze at 14:00 regardless of whether results have caught up.
- **Fail closed.** If the schedule feed is stale or the results feed lags past a threshold,
  freeze rather than risk trading on stale prices. There is a global "freeze all
  tournament-active players" kill switch.

**Why:** the only real manipulation surface is the window where a real-world result is
publicly known (someone's watching the stream) but the app hasn't ingested it and the market
is still tradeable at the old price. This also includes "buy an already-eliminated player
right before the dividend pays" (free money). Freezing on the schedule closes that window
for everyone regardless of feed speed.

**Consequence:** this **lets the game use a cheap, moderately-delayed results feed.** Feed
latency stops affecting correctness — it only affects *how long a player's market stays
frozen after their round*. What the feed must provide reliably: round start/end and
cut/finish events (state transitions, not live scores), a schedule (tee times) well in
advance, and finishing positions for dividends (never time-sensitive, cheapest source).

**Decision: mid-round / live trading is dropped.** The "value buy while my player is
struggling" feature from the original design is cut. It is exactly the manipulable surface,
and its exploitability scales with how many users are watching a stream the app can't see.
Trading happens between rounds only (rounds 1→2, 2→3, 3→4), during calm periods.

---

## 6. Price discovery: plain order book + bounded house market-maker

**The original design's anti-freeze mechanic is dropped.**

Original mechanic (from the volleyball doc): when a buy/sell order has no counterparty, the
engine creates/destroys shares at market price ±1, walking the price one unit at a time, so
there's always a fill and price moves are gradual.

Why it's being dropped:

- **It uncaps the money/share supply** and is itself an inflation engine — the exact
  "inflationary pressure" problem the original doc flagged as unsolved. Demand structurally
  exceeds shares-offered-for-sale (starting cash + dividend injections, fixed float), so
  creation vastly outruns destruction and prices ratchet up market-wide independent of skill.
- **It breaks the core fiction** ("value controlled completely by the market") — for thin
  players the price is set by a rule, not by anyone's opinion of the player.
- **"One unit at a time" doesn't prevent big moves** — a large order just walks many
  sub-steps in one transaction (the doc's own Lupo example moves 310→315 in one order). It's
  gradual for small orders and illusory for large ones, and it's deterministic/public so
  it's gameable.
- **It's pump-exploitable** — the counterparty is a rule that never says no, so you can
  ratchet a thin player up cheaply, attract real buyers, and sell into them.
- **It roughly doubles engine complexity** (share-count accounting, ghost stocks, the
  leftover-IPO-share special case, different in-market vs. in-tournament rules) — and
  share-accounting bugs in a game about shares are the worst kind.
- **The problem it solves is temporary** (cold-start / low liquidity at launch) but the
  mechanic and its costs are permanent. The golf-audience pivot is specifically intended to
  get enough concurrent traders that most players have natural two-sided markets.

**Replacement:**

- **A plain continuous order book.** Match buy vs. sell; unfilled quantity rests as a limit
  order with a duration (hours / days / until a named event / unlimited — carried from the
  original design). One well-understood code path, easy to test.
- **A bounded house market-maker for thin names.** The game quotes a bid/ask around a
  reference price (IPO price, or last dividend-implied value) with a spread (~5–10%). Players
  can always trade, but against the house at a deliberately unattractive price — not by
  minting shares. The house has a **capped inventory per player** so it can't be farmed
  infinitely. Fixed share count; no money printer.
- **Good resting-order UX + push notifications** ("your order is live", "your order filled")
  — this is how every real trading app works and is less frustrating than assumed.
- Possible later addition for very thin players: **periodic batch auctions** (orders collect,
  clear at one price) instead of continuous trading.

**During a tournament** (between rounds, player `open` but `active` in an event): order-book
matching only — no house market-maker share creation, consistent with the original design's
"no shares added/removed while active in a tournament." Investor-to-investor sales only.

---

## 7. IPO

Carried from the original design, still needs work:

- New players enter the market via IPO when first registered for a covered event.
- IPO price derived from entry/seed strength (original: a fraction of projected points).
- IPO period = entries close → first tee shot. Prices frozen during IPO; buy-only, no
  secondary trading.
- **TODO: the IPO share-count formula.** Original idea: ~10 shares per game investor, max 20
  per single investor, to prevent sell-outs. Needs to scale with active user count.
- Shares bought in the IPO = the starting float for that player.
- Unsold IPO players: one share added to the market at IPO price, purchasable during the
  tournament; removed if unsold when the player finishes.

---

## 8. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js (App Router)** | Known to the team; fine for all UI + API. |
| Database | **PostgreSQL** (managed: Neon or Supabase) | Transactions, `SELECT … FOR UPDATE` row locking (needed to serialize the matching engine per player), `CHECK` constraints (cash ≥ 0, shares ≥ 0), foreign keys. The design is highly relational and money-correctness is non-negotiable — this is the best case for a relational DB and the worst case for MongoDB's strengths. |
| DB access | **Drizzle ORM** | Thin, SQL-first, allows the explicit `FOR UPDATE` locking the engine needs. (Prisma is friendlier but fights advanced locking.) |
| Background jobs | **Inngest** | Event-driven + cron in one. Runs as a Next.js route handler — no separate service. Handles: schedule-driven freeze, round-result ingestion, dividend runs, order-queue processing, IPO lifecycle, retries, idempotency. |
| Cache / locks / pub-sub | **Redis** (Upstash) | Current-price cache, leaderboards, optional distributed lock, real-time fan-out backing. |
| Real-time to browser | Postgres `LISTEN/NOTIFY` → SSE, or Ably/Pusher | Price ticks, fill notifications. Decision deferred. |
| Money type | **Integers only** (Postgres `bigint`) | Currency appears to be whole units (prices ±1, points ÷ divisor). Never float. |
| Sports data | A golf data provider — TBD | Needs: reliable tee times (advance), round start/end + cut/finish events, finish positions. Does **not** need live shot-by-shot (the freeze design removes that requirement). Price for reliability/coverage, not latency. |

**MongoDB:** not used. If a flexible store is later wanted for non-financial content (cached
player bios/photos, news feed, denormalized player-card blobs), Postgres `jsonb` covers most
of it; a separate document store is a possible but unneeded addition.

---

## 9. The matching engine (notes for implementation)

The hard part of the project, regardless of stack.

- **Serialize per player.** Every order that could execute against player X acquires a lock
  on X first (`SELECT … FOR UPDATE` on the player's market row, or a Redis lock, or an
  Inngest concurrency key `player:X`). Different players match in parallel; same player
  queues.
- **Engine = pure function + a transaction.** Input: current market state (price, resting
  orders, house inventory) + new order. Output: a list of ledger entries + new price. Apply
  the whole list in one DB transaction. Testable without a database; portable.
- **Idempotency keys everywhere.** Client-generated UUID per order. Dividend payout key like
  `dividend:{tournamentId}:{playerId}:{investorId}:{event}`. Re-running any job must be safe.
- **Ledger is append-only.** Balances and holdings are derived from ledger entries, not
  mutable counters. Makes disputes answerable and a future Postgres→other migration of any
  slice easier.

---

## 10. Open TODOs

- [ ] IPO share-count formula (scales with active user count)
- [ ] Dividend divisor calibration (FedEx points → currency, so yields feel right vs. prices)
- [ ] Tier table: exact event tiers, points pools, and the coverage cut line
- [ ] Which tours are covered at launch (PGA only? PGA + DP World flagship? + full DP World?)
- [x] Off-season handling — **decided:** market closed Sep→Dec, hard annual reset each Jan
      (full liquidation Aug, identical fresh start + full field re-IPO Jan). See §4.
- [ ] Off-season prediction side-game during the Nov–Dec gap: yes/no
- [ ] Shoulder-season mini-competition: yes/no, and its rules
- [ ] Golf data provider selection + pricing
- [ ] Real-time transport decision (SSE vs. hosted pub-sub)
- [ ] Starting cash amount and "buy the field" onboarding discount (carried from volleyball,
      needs re-tuning for golf field sizes)
- [ ] Inflation mitigation beyond a fixed float — deferred; play-money inflation is tolerable
      early, revisit if it distorts the season
- [ ] Ghost-stock rules: keep, simplify, or drop given the order-book + house-MM model
- [ ] Weekly/monthly sub-competition scoring (original: % growth of total value + cash)
- [ ] Anti-manipulation detection query (flag accounts that trade a player heavily right
      before that player's scheduled freeze, then the result breaks their way)
