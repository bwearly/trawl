import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/get-current-user-id";
import {
  getOrCreateAlertPreferences,
  updateAlertPreferences,
} from "@/lib/domain/alerts/preferences";

export async function GET() {
  try {
    const preferences = await getOrCreateAlertPreferences(getCurrentUserId());
    return NextResponse.json(preferences);
  } catch (error) {
    console.error("Failed to load alert preferences:", error);
    return NextResponse.json(
      { error: "Failed to load alert preferences" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const minScore =
      body.minScore === undefined || body.minScore === null
        ? undefined
        : Number(body.minScore);

    const enableWatchedTickerAlerts =
      body.enableWatchedTickerAlerts === undefined
        ? undefined
        : Boolean(body.enableWatchedTickerAlerts);

    const enableWatchedPoliticianAlerts =
      body.enableWatchedPoliticianAlerts === undefined
        ? undefined
        : Boolean(body.enableWatchedPoliticianAlerts);

    if (minScore !== undefined && !Number.isFinite(minScore)) {
      return NextResponse.json(
        { error: "Valid minScore is required" },
        { status: 400 }
      );
    }

    const updated = await updateAlertPreferences(getCurrentUserId(), {
      minScore,
      enableWatchedTickerAlerts,
      enableWatchedPoliticianAlerts,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update alert preferences:", error);
    return NextResponse.json(
      { error: "Failed to update alert preferences" },
      { status: 500 }
    );
  }
}
