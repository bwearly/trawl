import { NextRequest, NextResponse } from "next/server";
import { requirePersonalizedUser } from "@/lib/auth/get-current-user-id";
import {
  addTickerToWatchlist,
  removeTickerFromWatchlist,
} from "@/lib/domain/watchlists/watchlists";

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

    const identity = await requirePersonalizedUser();
    await addTickerToWatchlist(identity.userId, ticker);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "PERSONALIZED_AUTH_REQUIRED") {
      return NextResponse.json({ error: "Authentication required for personalized actions." }, { status: 401 });
    }
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

    const identity = await requirePersonalizedUser();
    await removeTickerFromWatchlist(identity.userId, ticker);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "PERSONALIZED_AUTH_REQUIRED") {
      return NextResponse.json({ error: "Authentication required for personalized actions." }, { status: 401 });
    }
    console.error("Failed to remove ticker from watchlist:", error);
    return NextResponse.json(
      { error: "Failed to remove ticker from watchlist" },
      { status: 500 }
    );
  }
}
