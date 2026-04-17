import { NextRequest, NextResponse } from "next/server";
import {
  addTickerToWatchlist,
  removeTickerFromWatchlist,
} from "@/lib/domain/watchlists/watchlists";

const DEMO_USER_ID = "demo-user";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ticker = String(body.ticker ?? "").trim().toUpperCase();

    if (!ticker) {
      return NextResponse.json(
        { error: "Ticker is required" },
        { status: 400 }
      );
    }

    await addTickerToWatchlist(DEMO_USER_ID, ticker);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to add ticker to watchlist:", error);
    return NextResponse.json(
      { error: "Failed to add ticker to watchlist" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const ticker = String(body.ticker ?? "").trim().toUpperCase();

    if (!ticker) {
      return NextResponse.json(
        { error: "Ticker is required" },
        { status: 400 }
      );
    }

    await removeTickerFromWatchlist(DEMO_USER_ID, ticker);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to remove ticker from watchlist:", error);
    return NextResponse.json(
      { error: "Failed to remove ticker from watchlist" },
      { status: 500 }
    );
  }
}