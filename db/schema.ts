import { pgTable, pgEnum, text, bigint, timestamp, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// A forward declaration note for readers: `ledgerEntries`, defined further
// down this file, references `investors.id` via a FOREIGN KEY. Because it's
// all one file (or, once split, files loaded together by drizzle-kit), the
// declaration order here doesn't matter to Drizzle — but it does read more
// naturally top-down if the referenced table comes first, which is why
// investors and players still lead the file even though ledgerEntries will
// end up being what actually defines "current cash balance."

// ---------------------------------------------------------------------------
// investors
// ---------------------------------------------------------------------------
// One row per registered player of the game (a person, not a golfer —
// "player" is heavily overloaded in this domain, so the schema always says
// "investor" for the human and "player" for the golfer, matching the design
// doc's own vocabulary).
//
// TODO (deferred, not yet decided): once Auth.js is wired up (Google OAuth +
// email/password), its adapter owns its own users/accounts/sessions tables
// and already stores email. At that point `investors.id` should become a
// FOREIGN KEY into Auth.js's users table, and the `email` column here likely
// gets dropped to avoid two sources of truth for the same fact. Left as-is
// for now so game-table modeling isn't blocked on the auth setup.
export const investors = pgTable(
  "investors",
  {
    // pgTable's first argument ("investors") is the literal table name that
    // will exist in Postgres. The TS export name (investors) is what your
    // application code imports — they don't have to match, but keeping them
    // matched is the normal convention.

    id: text("id").primaryKey(),
    // A PRIMARY KEY is a Postgres-enforced guarantee: every value in this
    // column is unique, and none of them can be NULL. Postgres builds an
    // index on it automatically. Mongo's _id is the closest analog, except
    // Mongo generates it for you (ObjectId) — here we're using plain text
    // and will generate IDs ourselves in application code (e.g. a UUID or
    // an id from your auth provider). Nothing stops you from using a
    // Postgres-native auto-incrementing integer instead; text is chosen
    // here because it plays nicely with external IDs (Clerk/Auth.js user
    // ids, UUIDs) which is the more common real-world shape.

    email: text("email").notNull().unique(),
    // Two separate constraints stacked on one column:
    //   .notNull()  — Postgres rejects any INSERT/UPDATE that leaves this
    //                 column empty. There is no way to "forget" to set it,
    //                 unlike a Mongo document that can simply omit a field.
    //   .unique()   — Postgres rejects a second row with the same email.
    //                 This is a real index-backed constraint, checked on
    //                 every write, not something your app has to remember
    //                 to query-then-check itself (which always has a race
    //                 condition under concurrent requests — two signups at
    //                 the exact same millisecond can't both slip through).

    username: text("username").notNull().unique(),
    // Same pair of constraints as email, for the same reasons — this is the
    // display name shown on leaderboards, trade feeds, etc. It's a SEPARATE
    // unique constraint from email's, meaning Postgres tracks and enforces
    // them independently: two rows can't share a username OR share an
    // email, but nothing here ties the two columns together. If you later
    // want "username must be different from email," that's an application
    // rule, not something a plain UNIQUE constraint expresses.
    //
    // Note there's no length limit yet (e.g. "3-20 characters"). Postgres
    // can enforce that too, as a CHECK constraint (like cashNonNegative
    // below) — we're leaving it out for now since it's a product decision,
    // not a data-integrity one, but flagging that it belongs here once
    // you've decided the rule.

    // No cashBalance column here — deliberately. Per §9 of the design doc,
    // "balances and holdings are derived from ledger entries, not mutable
    // counters." An investor's current cash is
    // SUM(amount) FROM ledger_entries WHERE investor_id = this investor,
    // computed from the ledgerEntries table below — never stored as a
    // column you overwrite. See ledgerEntries' comment block for the full
    // reasoning; the short version is auditability (you can always answer
    // "how did this investor's balance get to this number") and safety
    // under concurrent writes (an overwritable counter is exactly the kind
    // of shared mutable state that's easy to corrupt with two simultaneous
    // trades; an append-only log of entries is not).

    createdAt: timestamp("created_at").notNull().defaultNow(),
    // defaultNow() — Postgres stamps the current time itself, at insert
    // time, on the database server. This is more reliable than having your
    // application code compute `new Date()` and send it, because it can't
    // drift if your app server's clock is wrong, and it's one less thing
    // your application has to remember to set on every insert path.
  },
  // No second (table-level constraints) argument needed anymore — it was
  // only there for the cash_non_negative CHECK, which moved to
  // ledgerEntries below along with the balance it protects. A plain
  // single-argument pgTable call like this is the normal shape for a table
  // with no table-level constraints; you'll see the array form return once
  // we get to a table that needs one (ledgerEntries, right after this).
);

// ---------------------------------------------------------------------------
// player status — a Postgres ENUM
// ---------------------------------------------------------------------------
// Straight from design-decisions.md §5's market states table:
//   not_in_market — player not teed up in any covered event this week
//   ipo           — buy-only at fixed IPO price, no secondary trading
//   open          — full trading (order book)
//   frozen        — no trading; resting orders held (round in progress)
//
// pgEnum creates a genuine Postgres type, not just a text column with an
// application-level check. This matters in a very concrete way: if a bug
// anywhere tries to write status = "closed" (a typo, or a status that used
// to exist and got renamed), Postgres rejects the INSERT/UPDATE outright —
// "invalid input value for enum player_status". Compare to storing this as
// plain text: a typo like "oepn" would simply sit in the database as
// silently-wrong data until something downstream broke in a confusing way.
//
// The tradeoff, and why some teams prefer plain text + a CHECK constraint
// instead: an enum's allowed values live in the DATABASE's type catalog, not
// in this file alone. Adding a new status later means an actual migration
// that alters the enum type (ALTER TYPE ... ADD VALUE) — more ceremony than
// editing a CHECK's list of allowed strings. For a small, stable set of
// states like this one (four values, unlikely to grow), the extra safety is
// worth that small cost.
export const playerStatusEnum = pgEnum("player_status", [
  "not_in_market",
  "ipo",
  "open",
  "frozen",
]);

// ---------------------------------------------------------------------------
// players
// ---------------------------------------------------------------------------
// One row per real-world golfer covered by the game. Deliberately NOT
// tour-specific (§4: "one global share per player") — a golfer who plays a
// PGA event one week and a DP World event the next is still the same row
// here, with `status` simply reflecting whether they're teed up somewhere
// covered this week.
export const players = pgTable("players", {
  id: text("id").primaryKey(),

  name: text("name").notNull(),
  // No .unique() here, deliberately — real names collide often enough
  // (multiple "Kim"s, "Lee"s, "Smith"s on tour) that name can't safely be
  // the uniqueness guarantee. `id` is what every other table will reference;
  // `name` is just for display.

  status: playerStatusEnum("status").notNull().default("not_in_market"),
  // The column's TS type is now literally the union
  // "not_in_market" | "ipo" | "open" | "frozen" — TypeScript itself will
  // refuse to compile code that tries to assign any other string here, on
  // top of Postgres refusing it at the database level. Two independent
  // layers catching the same class of mistake, which is the pattern you'll
  // see repeatedly in this schema: TS types for compile-time safety,
  // Postgres constraints for runtime/database safety, because application
  // code isn't the only thing that ever writes to this database (a manual
  // fix, an admin script, a future service in a different language — none
  // of those get TypeScript's help, but all of them get Postgres's).
});

// ---------------------------------------------------------------------------
// ledgerEntries
// ---------------------------------------------------------------------------
// The single source of truth for every investor's cash, per §9: "Ledger is
// append-only. Balances and holdings are derived from ledger entries, not
// mutable counters."
//
// The core idea: instead of one row per investor holding a "current
// balance" number that gets overwritten on every trade, this table holds
// ONE ROW PER MONEY-MOVING EVENT — starting grant, a buy, a sell, a dividend
// payout. An investor's current balance is never stored directly; it's
// always computed as:
//
//   SELECT SUM(amount) FROM ledger_entries WHERE investor_id = X
//
// Why this beats a mutable "cashBalance" column, concretely:
//
// 1. AUDITABILITY. If an investor disputes their balance ("I should have
//    more than this"), you can show the exact list of every entry that
//    produced today's number. A mutable column that's been overwritten a
//    thousand times has no memory of how it got there — you'd need to have
//    separately logged every change, which is just... reinventing this
//    table, badly.
//
// 2. CONCURRENCY SAFETY. Imagine two things try to change an investor's
//    balance at the same instant — a sell fills AND a dividend pays out in
//    the same moment. With a mutable column, both operations do roughly
//    "read current value, compute new value, write new value back" — and
//    without careful locking, one write can clobber the other (the classic
//    "lost update" bug). With an append-only ledger, both operations just
//    INSERT a new row. Two inserts can happen concurrently with no
//    conflict at all — there's nothing to clobber. The SUM is always
//    correct because every event that ever happened is still sitting there
//    as its own row.
//
// 3. IDEMPOTENCY (also called out in §9). Every ledger entry gets a unique
//    idempotencyKey (e.g. "dividend:{tournamentId}:{playerId}:{investorId}").
//    If a background job crashes and retries, it tries to insert the same
//    key twice — the UNIQUE constraint below rejects the duplicate, so a
//    retried job can never double-pay someone. This is essentially
//    impossible to get right with a mutable counter (how do you tell "this
//    dividend was already applied" apart from "it wasn't" once the
//    increment has already happened and left no trace of *why*?).
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),

    investorId: text("investor_id")
      .notNull()
      .references(() => investors.id),
    // THIS is a Postgres FOREIGN KEY — the first one in this schema.
    // .references(() => investors.id) tells Postgres: "every value in this
    // column must equal some existing investors.id." Two concrete
    // consequences:
    //   - You CANNOT insert a ledger entry for an investor that doesn't
    //     exist. Postgres checks this on every insert, rejecting typos or
    //     stale IDs outright — there is no equivalent guarantee in Mongo,
    //     where a wrong ObjectId reference just silently fails to ever
    //     match anything when you later try to look it up.
    //   - By default, Postgres also PREVENTS deleting an investor row while
    //     ledger entries still reference it (a "foreign key violation"
    //     error) — which is usually exactly what you want here: you should
    //     never be able to delete an investor and silently orphan their
    //     entire financial history.
    // The arrow function `() => investors.id` (rather than just
    // `investors.id` directly) exists so Drizzle can handle tables that
    // reference each other, or reference themselves, without a chicken-and-
    // egg problem at module-load time.

    amount: bigint("amount", { mode: "number" }).notNull(),
    // Signed — positive for money in (starting grant, a sale, a dividend),
    // negative for money out (a buy). This is what makes SUM(amount) work
    // as "current balance" — it's simple arithmetic over the whole history,
    // not a state machine you have to reconstruct.

    reason: text("reason").notNull(),
    // What kind of event this was — e.g. "starting_grant", "buy", "sell",
    // "dividend". Plain text for now rather than a pgEnum like player
    // status: the set of ledger reasons is much more likely to grow as the
    // game grows (new event types, new mini-competitions), and unlike
    // player status this doesn't gate a matching-engine state machine — so
    // the lower-ceremony option (plain text) fits better here. This is a
    // judgment call, not a hard rule; revisit if it causes problems.

    idempotencyKey: text("idempotency_key").notNull().unique(),
    // See point 3 above. Every code path that writes a ledger entry
    // (matching engine, dividend job, IPO grant) must generate a
    // deterministic key for the event it's recording, so that re-running
    // the same logical operation twice — a retried background job, a
    // network hiccup that caused a client to resubmit — can never double-
    // apply. The UNIQUE constraint is what makes this a real guarantee
    // rather than a convention your code has to remember to honor.

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("ledger_entries_amount_not_zero", sql`${table.amount} != 0`),
    // A ledger entry that moves $0 isn't meaningless by accident — it's
    // almost certainly a bug (a dividend calculation that produced zero
    // when it shouldn't have, a buy order for zero shares that should have
    // been rejected upstream). This CHECK turns that class of bug into an
    // immediate, loud database error instead of a silent do-nothing row
    // quietly sitting in your financial history.
  ],
);

// ---------------------------------------------------------------------------
// seasonResults
// ---------------------------------------------------------------------------
// The ONE table in this schema that's designed to survive the annual reset.
//
// Per the annual-reset decision: each January, a fresh Postgres SCHEMA is
// created for the new season (e.g. `season_2028`) holding its own copies of
// investors/players/holdings/orders/ledger_entries — all the live, in-season
// game state. At season end, that schema's data is summarized and copied
// here, into `public.season_results`, before the season schema is retired.
// This table is the one exception living in the permanent `public` schema
// (alongside `investors`, since an investor identity needs to persist across
// seasons even though their in-season game state doesn't).
//
// Shape: ONE ROW PER INVESTOR PER SEASON — not one column per season. See
// the discussion that led here: a "rank_2027, rank_2028, ..." column-per-
// year design would need a schema migration every single year just because
// time passed, can't be queried generically ("show all of investor X's
// seasons" becomes inspecting a growing, hardcoded list of columns), and
// leaves permanent NULL columns for anyone who skips a season. This
// row-per-season shape needs zero migrations to add a new season — it's
// just new INSERTs — and follows the exact same principle as ledgerEntries
// above: a new fact over time is a new ROW, not a new COLUMN.
export const seasonResults = pgTable(
  "season_results",
  {
    id: text("id").primaryKey(),

    investorId: text("investor_id")
      .notNull()
      .references(() => investors.id),
    // Same FOREIGN KEY pattern as ledgerEntries.investorId — Postgres
    // guarantees this always points at a real investor, and (by default)
    // blocks deleting an investor while their season history still
    // references them.

    seasonLabel: text("season_label").notNull(),
    // Plain text, e.g. "2027" — deliberately NOT a pgEnum like player
    // status. An enum's allowed values live in the database's type catalog
    // and require a migration to extend; a season label is exactly the
    // kind of value that grows by one, predictably, every single year, so
    // the lower-ceremony plain-text column is the better fit here (same
    // reasoning as ledgerEntries.reason above).

    finalRank: bigint("final_rank", { mode: "number" }).notNull(),
    // 1 = the season winner. Stored as the literal final standing, computed
    // once at season-end and written here — this table holds settled,
    // historical facts, not something recomputed live (contrast with
    // ledgerEntries, where current balance is ALWAYS computed fresh from
    // the sum; here, the season is OVER, the rank is final, so storing the
    // computed result directly is correct, not a shortcut).

    finalPortfolioValue: bigint("final_portfolio_value", { mode: "number" }).notNull(),
    // The investor's total value (cash + liquidated shares) at the moment
    // of the Tour Championship liquidation (§4). Same bigint/integer-only
    // reasoning as everywhere else money appears in this schema (§8: never
    // float).

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("season_results_rank_positive", sql`${table.finalRank} >= 1`),
    // Rank 0 or negative can't be a real standing — same philosophy as
    // ledger_entries_amount_not_zero: catch an impossible value at the
    // database level rather than trusting every future code path that ever
    // writes here to remember the rule.

    check(
      "season_results_value_non_negative",
      sql`${table.finalPortfolioValue} >= 0`,
    ),
    // Mirrors investors' old cash_non_negative rule (now living on
    // ledgerEntries' balance instead) — a portfolio's total settled value
    // can be zero (a terrible season) but never negative.

    unique("season_results_investor_season_unique").on(
      table.investorId,
      table.seasonLabel,
    ),
    // A COMPOSITE unique constraint — unique across the COMBINATION of two
    // columns, not either column alone. Contrast with investors.email /
    // investors.username earlier, where .unique() was chained directly onto
    // a single column (a "column-level" constraint, sugar for exactly this
    // same table-level form with one column instead of two).
    //
    // What this actually forbids: two rows with the SAME investorId AND the
    // SAME seasonLabel at once. It does NOT forbid:
    //   - the same investorId appearing many times (once per season they
    //     played — that's the whole point of this table)
    //   - the same seasonLabel appearing many times (once per investor who
    //     played that season — also the whole point)
    // Only the exact pairing repeating is what's disallowed — e.g. investor
    // "greg" can't have two separate "2027" rows, which would otherwise
    // leave it ambiguous which row is their real 2027 result.
    //
    // Why this matters concretely: without it, a bug that runs the
    // end-of-season summarization job twice (a retry, a duplicate cron
    // trigger) would silently insert a second "2027" row for every
    // investor — duplicate history, wrong-looking leaderboards, no error
    // anywhere to reveal it happened. With the constraint, that second
    // insert attempt fails loudly and immediately, the same category of
    // protection idempotencyKey gives ledgerEntries against double-paying
    // a dividend.
  ],
);
