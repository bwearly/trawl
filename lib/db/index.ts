import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

const databaseUrl =
  process.env.TRAWL_DATABASE_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL or TRAWL_DATABASE_DATABASE_URL is not set");
}

const sql = neon(databaseUrl);

export const db = drizzle(sql);