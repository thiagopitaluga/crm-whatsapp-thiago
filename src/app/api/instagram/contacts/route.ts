import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const query = (new URL(request.url).searchParams.get('q') || '')
      .replace(/[^\p{L}\p{N} +@.\-_]/gu, '')
      .trim()
      .slice(0, 80);
    if (query.length < 2) return NextResponse.json({ contacts: [] });
    const { data, error } = await supabaseAdmin()
      .from('contacts')
      .select('id,name,phone')
      .eq('account_id', ctx.accountId)
      .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
      .order('name')
      .limit(20);
    if (error) throw error;
    return NextResponse.json({ contacts: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}
