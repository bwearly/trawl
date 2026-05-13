import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/get-current-user-id";
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

    await markAlertAsRead(getCurrentUserId(), alertId);

    return NextResponse.redirect(new URL("/alerts", request.url), {
      status: 303,
    });
  } catch (error) {
    console.error("Failed to mark alert as read:", error);
    return NextResponse.json(
      { error: "Failed to mark alert as read" },
      { status: 500 }
    );
  }
}
