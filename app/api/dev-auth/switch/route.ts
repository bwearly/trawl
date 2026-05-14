import { NextRequest, NextResponse } from "next/server";
import {
  DEV_ALLOWED_USER_IDS,
  DEV_AUTH_COOKIE_NAME,
  DEMO_FALLBACK_USER_ID,
} from "@/lib/auth/auth-identity";
import { isAllowedDevUserId } from "@/lib/auth/get-current-user-id";

function isDisabled() {
  return process.env.NODE_ENV === "production";
}

export async function POST(request: NextRequest) {
  if (isDisabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const candidate = body?.userId;

  if (!isAllowedDevUserId(candidate)) {
    return NextResponse.json(
      {
        error: "Invalid userId",
        allowedUserIds: DEV_ALLOWED_USER_IDS,
      },
      { status: 400 }
    );
  }

  const response = NextResponse.json({
    userId: candidate,
    source: "dev-cookie",
    fallbackUserId: DEMO_FALLBACK_USER_ID,
  });

  response.cookies.set({
    name: DEV_AUTH_COOKIE_NAME,
    value: candidate,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return response;
}
