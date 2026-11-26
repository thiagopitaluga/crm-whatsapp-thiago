import type { SupabaseClient } from '@supabase/supabase-js';
import type { serviceFeatures } from './access';
export async function serviceEnabled(
  db: SupabaseClient,
  accountId: string,
  feature: keyof typeof serviceFeatures
): Promise<boolean> {
  const { data, error } = await db.rpc('billing_effective_access', {
    p_account_id: accountId,
  });
  if (error)
    throw new Error('Não foi possível verificar os recursos da empresa.');
  return data?.features?.[feature] !== false;
}
