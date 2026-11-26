'use server';

import { parseAccessForm } from '@/lib/billing/access';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import {
  billingIntervals,
  billingStatuses,
  isBillingDate,
  parseBillingPrice,
} from '@/lib/billing/subscriptions';

type FormResult = { message: string; ok: boolean };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const read = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

export async function createPlan(
  _previous: FormResult | null,
  data: FormData
): Promise<FormResult> {
  try {
    const actor = await requirePlatformAdmin();
    const name = read(data, 'name');
    const interval = read(data, 'interval');
    const cents = parseBillingPrice(read(data, 'amount'));
    if (
      !name ||
      name.length > 80 ||
      !Object.hasOwn(billingIntervals, interval) ||
      cents === null
    ) {
      return {
        ok: false,
        message: 'Informe nome, periodicidade e valor válido em reais.',
      };
    }

    const { error } = await supabaseAdmin().rpc('billing_create_plan', {
      p_actor_user_id: actor.userId,
      p_actor_email: actor.email,
      p_name: name,
      p_interval: interval,
      p_amount_cents: cents,
    });
    if (error?.code === '23505')
      return {
        ok: false,
        message: 'Já existe um plano com esse nome, período e valor.',
      };
    if (error) throw error;
    revalidatePath('/thiago/assinaturas');
    return { ok: true, message: 'Plano cadastrado.' };
  } catch (error) {
    console.error('[billing] create plan failed', error);
    return { ok: false, message: 'Não foi possível cadastrar o plano.' };
  }
}

export async function saveSubscription(
  accountId: string,
  _previous: FormResult | null,
  data: FormData
): Promise<FormResult> {
  try {
    const actor = await requirePlatformAdmin();
    const planId = read(data, 'planId');
    const status = read(data, 'status');
    const periodEnd = read(data, 'periodEnd');
    if (
      !uuid.test(accountId) ||
      !uuid.test(planId) ||
      !Object.hasOwn(billingStatuses, status)
    ) {
      return { ok: false, message: 'Selecione um plano e um status válidos.' };
    }
    if (
      (periodEnd && !isBillingDate(periodEnd)) ||
      (['active', 'trialing', 'past_due'].includes(status) && !periodEnd)
    ) {
      return {
        ok: false,
        message: 'Informe uma data válida para o fim do período.',
      };
    }

    const { error } = await supabaseAdmin().rpc('billing_set_subscription', {
      p_actor_user_id: actor.userId,
      p_actor_email: actor.email,
      p_account_id: accountId,
      p_plan_id: planId,
      p_status: status,
      p_period_end: periodEnd || null,
    });
    if (error) throw error;
    revalidatePath('/thiago/assinaturas');
    revalidatePath('/assinatura');
    return { ok: true, message: 'Assinatura atualizada.' };
  } catch (error) {
    console.error('[billing] save subscription failed', error);
    return { ok: false, message: 'Não foi possível registrar a assinatura.' };
  }
}

export async function saveAccess(
  accountId: string,
  _previous: FormResult | null,
  data: FormData
): Promise<FormResult> {
  try {
    const actor = await requirePlatformAdmin();
    if (!uuid.test(accountId))
      return { ok: false, message: 'Empresa inválida.' };
    const access = parseAccessForm(data);
    const { error } = await supabaseAdmin().rpc('billing_save_access', {
      p_actor_user_id: actor.userId,
      p_actor_email: actor.email,
      p_account_id: accountId,
      p_complimentary: access.complimentary,
      p_features: access.features,
      p_limits: access.limits,
    });
    if (error) throw error;
    revalidatePath('/thiago/assinaturas');
    revalidatePath('/assinatura');
    return { ok: true, message: 'Acesso personalizado atualizado.' };
  } catch (error) {
    console.error('[billing] access update failed', error);
    return {
      ok: false,
      message:
        error instanceof Error && error.message.startsWith('Limite inválido')
          ? error.message
          : 'Não foi possível salvar o acesso.',
    };
  }
}
