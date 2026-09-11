import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

export const runtime = "nodejs";

function supabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Returns connection state only. Calendar OAuth tokens are intentionally
 * never sent to the browser; they remain encrypted in a service-only table.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await supabaseAdmin()
      .from("google_calendar_connections")
      .select("status, calendar_id")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[google-calendar] status query failed:", error.message);
      return NextResponse.json({ error: "Failed to load Google Calendar status" }, { status: 500 });
    }

    const connected = data?.status === "connected";
    return NextResponse.json({
      connected,
      available: Boolean(
        process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      ),
      calendar_url: connected ? "https://calendar.google.com/" : null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
