import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Anonymous counters used only to protect the public demo quota. */
export const demoClientUsage = sqliteTable("demo_client_usage", {
  day: text("day").notNull(),
  clientHash: text("client_hash").notNull(),
  requestCount: integer("request_count").notNull().default(0),
}, (table) => [primaryKey({columns:[table.day, table.clientHash]})]);

export const demoDailyUsage = sqliteTable("demo_daily_usage", {
  day: text("day").primaryKey(),
  requestCount: integer("request_count").notNull().default(0),
});
