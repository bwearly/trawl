import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/get-current-user-id";
import { markAllAlertsAsRead } from "@/lib/domain/alerts/alerts";

export async function POST(request: NextRequest) {
  try {
    await markAllAlertsAsRead(await getCurrentUserId());

    return NextResponse.redirect(new URL("/alerts", request.url), {
      status: 303,
    });
  } catch (error) {
    console.error("Failed to mark all alerts as read:", error);
    return NextResponse.json(
      { error: "Failed to mark all alerts as read" },
      { status: 500 }
    );
  }
}
