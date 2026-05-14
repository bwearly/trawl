import { NextRequest, NextResponse } from "next/server";
import { requirePersonalizedUser } from "@/lib/auth/get-current-user-id";
import { markAlertAsRead } from "@/lib/domain/alerts/alerts";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const alertId = Number(id);

    if (!Number.isFinite(alertId)) {
      return NextResponse.json(
        { error: "Valid alert id is required" },
        { status: 400 }
      );
    }

    const identity = await requirePersonalizedUser();
    await markAlertAsRead(identity.userId, alertId);

    return NextResponse.redirect(new URL("/alerts", request.url), {
      status: 303,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PERSONALIZED_AUTH_REQUIRED") {
      return NextResponse.json({ error: "Authentication required for personalized actions." }, { status: 401 });
    }
    console.error("Failed to mark alert as read:", error);
    return NextResponse.json(
      { error: "Failed to mark alert as read" },
      { status: 500 }
    );
  }
}
