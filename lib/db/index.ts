import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

if (!process.env.TRAWL_DATABASE_DATABASE_URL) {
  throw new Error("TRAWL_DATABASE_DATABASE_URL is not set");
}

const sql = neon(process.env.TRAWL_DATABASE_DATABASE_URL);

export const db = drizzle(sql);
