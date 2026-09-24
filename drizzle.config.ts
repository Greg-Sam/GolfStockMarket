import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Where drizzle-kit finds your table definitions (Step 2, below).
  // Glob pattern, in case you split schema into multiple files later
  // (e.g. schema/players.ts, schema/orders.ts).
  schema: "./db/schema.ts",

  // Where drizzle-kit writes generated SQL migration files.
  // This directory gets committed to git (see .gitignore — we deliberately
  // did NOT ignore it) because migrations are a versioned history of your
  // database's shape, same as your source code.
  out: "./drizzle",

  // Which SQL dialect to generate. Postgres has different syntax than
  // MySQL/SQLite for things like SERIAL columns, so this isn't optional.
  dialect: "postgresql",

  // How drizzle-kit connects to a real database when you run `migrate`
  // (it does NOT need this for `generate`, which only reads schema.ts —
  // but the config requires it be present).
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },

  // Prints every SQL statement drizzle-kit executes. Invaluable while
  // learning — you see exactly what's about to hit the database, not just
  // a "success" message.
  verbose: true,

  // Asks for confirmation before certain destructive-looking operations
  // (e.g. it thinks you're dropping a column). Extra safety net; costs
  // nothing.
  strict: true,
});
