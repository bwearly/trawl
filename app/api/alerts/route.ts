import { NextRequest, NextResponse } from "next/server";
import { requirePersonalizedUser } from "@/lib/auth/get-current-user-id";
import { markAllAlertsAsRead } from "@/lib/domain/alerts/alerts";

export async function POST(request: NextRequest) {
  try {
    const identity = await requirePersonalizedUser();
    await markAllAlertsAsRead(identity.userId);

    return NextResponse.redirect(new URL("/alerts", request.url), {
      status: 303,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PERSONALIZED_AUTH_REQUIRED") {
      return NextResponse.json({ error: "Authentication required for personalized actions." }, { status: 401 });
    }
    console.error("Failed to mark all alerts as read:", error);
    return NextResponse.json(
      { error: "Failed to mark all alerts as read" },
      { status: 500 }
    );
  }
}
