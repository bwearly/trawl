import { NextResponse } from "next/server";
import { requirePersonalizedUser } from "@/lib/auth/get-current-user-id";
import { getUnreadAlertsCount } from "@/lib/domain/alerts/alerts";

export async function GET() {
  try {
    const identity = await requirePersonalizedUser();
    const unreadCount = await getUnreadAlertsCount(identity.userId);
    return NextResponse.json({ unreadCount });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "PERSONALIZED_AUTH_REQUIRED"
    ) {
      return NextResponse.json(
        { error: "Authentication required for personalized actions." },
        { status: 401 }
      );
    }

    console.error("Failed to get unread alerts count:", error);
    return NextResponse.json(
      { error: "Failed to get unread alerts count" },
      { status: 500 }
    );
  }
}
