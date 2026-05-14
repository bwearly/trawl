import { NextResponse } from "next/server";
import { DEV_ALLOWED_USER_IDS, DEV_AUTH_COOKIE_NAME } from "@/lib/auth/auth-identity";
import { resolveCurrentUserIdentity } from "@/lib/auth/get-current-user-id";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const identity = await resolveCurrentUserIdentity();

  return NextResponse.json({
    ...identity,
    cookieName: DEV_AUTH_COOKIE_NAME,
    allowedUserIds: DEV_ALLOWED_USER_IDS,
  });
}
