import { NextRequest, NextResponse } from "next/server";
import { markAllAlertsAsRead } from "@/lib/domain/alerts/alerts";

const DEMO_USER_ID = "demo-user";

export async function POST(request: NextRequest) {
  try {
    await markAllAlertsAsRead(DEMO_USER_ID);

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