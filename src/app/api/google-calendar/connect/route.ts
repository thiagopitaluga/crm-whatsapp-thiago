import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

export const runtime = "nodejs";

function signState(payload: string) {
  return crypto
    .createHmac("sha256", process.env.ENCRYPTION_KEY!)
    .update(payload)
    .digest("base64url");
}

/** Starts an account-scoped Google OAuth flow. Only an account admin may
 * replace the shared calendar connection. */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
    const origin = new URL(request.url).origin;

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(`${origin}/tasks?google_calendar=not_configured`);
    }

    const payload = Buffer.from(
      JSON.stringify({
        accountId: ctx.accountId,
        userId: ctx.userId,
        exp: Date.now() + 10 * 60_000,
      }),
    ).toString("base64url");
    const state = `${payload}.${signState(payload)}`;

    const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorization.searchParams.set("client_id", clientId);
    authorization.searchParams.set("redirect_uri", `${origin}/api/google-calendar/callback`);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.events");
    authorization.searchParams.set("access_type", "offline");
    authorization.searchParams.set("prompt", "consent");
    authorization.searchParams.set("state", state);

    return NextResponse.redirect(authorization);
  } catch (error) {
    return toErrorResponse(error);
  }
}
