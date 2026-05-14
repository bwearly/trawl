import { NextRequest, NextResponse } from "next/server";
import { requirePersonalizedUser } from "@/lib/auth/get-current-user-id";
import {
  addPoliticianToWatchlist,
  removePoliticianFromWatchlist,
} from "@/lib/domain/watchlists/watchlists";

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

    const identity = await requirePersonalizedUser();
    await addPoliticianToWatchlist(identity.userId, politicianId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "PERSONALIZED_AUTH_REQUIRED") {
      return NextResponse.json({ error: "Authentication required for personalized actions." }, { status: 401 });
    }
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

    const identity = await requirePersonalizedUser();
    await removePoliticianFromWatchlist(identity.userId, politicianId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "PERSONALIZED_AUTH_REQUIRED") {
      return NextResponse.json({ error: "Authentication required for personalized actions." }, { status: 401 });
    }
    console.error("Failed to remove politician from watchlist:", error);
    return NextResponse.json(
      { error: "Failed to remove politician from watchlist" },
      { status: 500 }
    );
  }
}
