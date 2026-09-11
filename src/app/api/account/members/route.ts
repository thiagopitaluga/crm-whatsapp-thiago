// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import type { AccountMember } from "@/types";

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface MembershipRow {
  user_id: string;
  role: string;
  created_at: string;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // A profile only keeps its *active* account. Memberships are the
    // source of truth, so a teammate remains in this roster even while
    // they are currently working in another company.
    const { data: membershipRows, error: membershipsError } = await ctx.supabase
      .from("account_memberships")
      .select("user_id, role, created_at")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (membershipsError) {
      console.error("[GET /api/account/members] membership fetch error:", membershipsError);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    const memberships = (membershipRows ?? []) as MembershipRow[];
    const userIds = memberships.map((membership) => membership.user_id);
    const { data: profileRows, error: profilesError } = userIds.length
      ? await ctx.supabase
        .from("profiles")
        .select("user_id, full_name, email, avatar_url, created_at")
        .in("user_id", userIds)
      : { data: [], error: null };

    if (profilesError) {
      console.error("[GET /api/account/members] profile fetch error:", profilesError);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    const canSeeEmails = canManageMembers(ctx.role);
    const profilesByUser = new Map(
      ((profileRows ?? []) as ProfileRow[]).map((profile) => [profile.user_id, profile]),
    );

    const members: AccountMember[] = memberships.flatMap((membership) => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(membership.role)) return [];
      const profile = profilesByUser.get(membership.user_id);
      if (!profile) return [];
      return [
        {
          user_id: membership.user_id,
          full_name: profile.full_name ?? "",
          email: canSeeEmails ? profile.email : null,
          avatar_url: profile.avatar_url,
          role: membership.role,
          joined_at: membership.created_at,
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
