import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { encrypt } from "@/lib/whatsapp/encryption";

export const runtime = "nodejs";

type SignedState = { accountId: string; userId: string; exp: number };

function verifyState(value: string | null): SignedState | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = crypto
    .createHmac("sha256", process.env.ENCRYPTION_KEY!)
    .update(payload)
    .digest("base64url");
  const actual = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length || !crypto.timingSafeEqual(actual, expectedBuffer)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SignedState;
    return parsed.exp > Date.now() && parsed.accountId && parsed.userId ? parsed : null;
  } catch {
    return null;
  }
}

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const state = verifyState(request.nextUrl.searchParams.get("state"));
  const code = request.nextUrl.searchParams.get("code");
  if (!state || !code) {
    return NextResponse.redirect(`${origin}/tasks?google_calendar=error`);
  }

  try {
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error("Google OAuth credentials are not configured");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/api/google-calendar/callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
    };
    if (!tokenResponse.ok || !tokens.access_token) {
      throw new Error(tokens.error || "Google token exchange failed");
    }

    const db = admin();
    const { data: existing } = await db
      .from("google_calendar_connections")
      .select("refresh_token_encrypted")
      .eq("account_id", state.accountId)
      .maybeSingle();
    const { error } = await db.from("google_calendar_connections").upsert(
      {
        account_id: state.accountId,
        user_id: state.userId,
        calendar_id: "primary",
        access_token_encrypted: encrypt(tokens.access_token),
        refresh_token_encrypted: tokens.refresh_token
          ? encrypt(tokens.refresh_token)
          : existing?.refresh_token_encrypted ?? null,
        token_expires_at: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null,
        scopes: tokens.scope?.split(" ").filter(Boolean) ?? [],
        status: "connected",
        last_error: null,
      },
      { onConflict: "account_id" },
    );
    if (error) throw error;

    return NextResponse.redirect(`${origin}/tasks?google_calendar=connected`);
  } catch (error) {
    console.error("[google-calendar] OAuth callback failed:", error);
    await admin()
      .from("google_calendar_connections")
      .update({ status: "error", last_error: "OAuth connection failed" })
      .eq("account_id", state.accountId);
    return NextResponse.redirect(`${origin}/tasks?google_calendar=error`);
  }
}
