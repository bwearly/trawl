import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/get-current-user-id";
import { getWatchlist } from "@/lib/domain/watchlists/watchlists";

export async function GET() {
  try {
    const data = await getWatchlist(await getCurrentUserId());
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load watchlist:", error);
    return NextResponse.json(
      { error: "Failed to load watchlist" },
      { status: 500 }
    );
  }
}
