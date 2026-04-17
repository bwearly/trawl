import { NextRequest, NextResponse } from "next/server";
import {
  addPoliticianToWatchlist,
  removePoliticianFromWatchlist,
} from "@/lib/domain/watchlists/watchlists";

const DEMO_USER_ID = "demo-user";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const politicianId = Number(body.politicianId);

    if (!Number.isFinite(politicianId)) {
      return NextResponse.json(
        { error: "Valid politicianId is required" },
        { status: 400 }
      );
    }

    await addPoliticianToWatchlist(DEMO_USER_ID, politicianId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to add politician to watchlist:", error);
    return NextResponse.json(
      { error: "Failed to add politician to watchlist" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const politicianId = Number(body.politicianId);

    if (!Number.isFinite(politicianId)) {
      return NextResponse.json(
        { error: "Valid politicianId is required" },
        { status: 400 }
      );
    }

    await removePoliticianFromWatchlist(DEMO_USER_ID, politicianId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to remove politician from watchlist:", error);
    return NextResponse.json(
      { error: "Failed to remove politician from watchlist" },
      { status: 500 }
    );
  }
}