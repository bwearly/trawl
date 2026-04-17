import { NextResponse } from "next/server";
import { getWatchlist } from "@/lib/domain/watchlists/watchlists";

const DEMO_USER_ID = "demo-user";

export async function GET() {
  try {
    const data = await getWatchlist(DEMO_USER_ID);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load watchlist:", error);
    return NextResponse.json(
      { error: "Failed to load watchlist" },
      { status: 500 }
    );
  }
}