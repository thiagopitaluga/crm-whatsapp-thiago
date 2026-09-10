import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  exchangeEmbeddedSignupCode,
  subscribeWabaToApp,
  verifyPhoneNumber,
  wabaContainsPhoneNumber,
} from '@/lib/whatsapp/meta-api'

export const runtime = 'nodejs'

const idPattern = /^\d{5,30}$/

// The browser supplies only Meta's short-lived code and public IDs. The
// permanent token never leaves this handler and is encrypted before storage.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json()) as Record<string, unknown>
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const phoneNumberId =
      typeof body.phone_number_id === 'string' ? body.phone_number_id.trim() : ''
    const wabaId = typeof body.waba_id === 'string' ? body.waba_id.trim() : ''

    if (!code || code.length > 4096 || !idPattern.test(phoneNumberId) || !idPattern.test(wabaId)) {
      return NextResponse.json({ error: 'Dados de conexão inválidos.' }, { status: 400 })
    }

    const appId = process.env.META_APP_ID
    const appSecret = process.env.META_APP_SECRET
    if (!appId || !appSecret) {
      console.error('[embedded-signup] Meta app credentials are not configured')
      return NextResponse.json({ error: 'A integração Meta ainda não foi configurada no servidor.' }, { status: 503 })
    }

    const accessToken = await exchangeEmbeddedSignupCode({ code, appId, appSecret })
    const [phoneInfo, belongsToWaba] = await Promise.all([
      verifyPhoneNumber({ phoneNumberId, accessToken }),
      wabaContainsPhoneNumber({ wabaId, phoneNumberId, accessToken }),
    ])
    if (!belongsToWaba) {
      return NextResponse.json(
        { error: 'O número selecionado não pertence à conta do WhatsApp informada.' },
        { status: 400 },
      )
    }

    // A service role lookup is necessary here because normal RLS deliberately
    // hides other tenants' configurations.
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: claimed, error: claimedError } = await admin
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phoneNumberId)
      .neq('account_id', ctx.accountId)
      .maybeSingle()
    if (claimedError) throw claimedError
    if (claimed) {
      return NextResponse.json(
        { error: 'Este número já está conectado a outra conta deste CRM.' },
        { status: 409 },
      )
    }

    await subscribeWabaToApp({ wabaId, accessToken })

    const now = new Date().toISOString()
    const verifyToken = crypto.randomUUID().replace(/-/g, '')
    const row = {
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      access_token: encrypt(accessToken),
      verify_token: encrypt(verifyToken),
      status: 'connected',
      connected_at: now,
      // Meta finishes number registration as part of a successful Embedded
      // Signup session; unlike the manual flow, no 2FA PIN is handled here.
      registered_at: now,
      subscribed_apps_at: now,
      last_registration_error: null,
      updated_at: now,
    }

    const { data: existing, error: existingError } = await ctx.supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (existingError) throw existingError

    const write = existing
      ? ctx.supabase.from('whatsapp_config').update(row).eq('account_id', ctx.accountId)
      : ctx.supabase.from('whatsapp_config').insert({
          account_id: ctx.accountId,
          user_id: ctx.userId,
          ...row,
        })
    const { error: writeError } = await write
    if (writeError) throw writeError

    return NextResponse.json({
      success: true,
      phone: {
        id: phoneInfo.id,
        display_phone_number: phoneInfo.display_phone_number,
        verified_name: phoneInfo.verified_name ?? null,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
