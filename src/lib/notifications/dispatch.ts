import webpush from 'web-push';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { fetchQrConnector } from '@/lib/whatsapp/qr-connector';

export function isQuiet(settings: Record<string, unknown>, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';
  if (settings.weekends && ['Sat', 'Sun'].includes(part('weekday')))
    return true;
  const time = `${part('hour')}:${part('minute')}`;
  const start = String(settings.quietStart ?? '22:00'),
    end = String(settings.quietEnd ?? '08:00');
  return start === end
    ? false
    : start < end
      ? time >= start && time < end
      : time >= start || time < end;
}

export async function dispatchNotifications() {
  const db = supabaseAdmin();
  // Only recent deadlines are queued; unique source keys prevent repeat reminders.
  const tasks = await db
    .from('tasks')
    .select('id,account_id,assigned_to,user_id,contact_id')
    .eq('status', 'open')
    .lte('due_at', new Date().toISOString())
    .gte('due_at', new Date(Date.now() - 86_400_000).toISOString())
    .limit(100);
  for (const task of tasks.data ?? []) {
    const assignee = task.assigned_to
      ? await db
          .from('profiles')
          .select('user_id')
          .eq('id', task.assigned_to)
          .eq('account_id', task.account_id)
          .maybeSingle()
      : null;
    await db.from('notifications').upsert(
      {
        account_id: task.account_id,
        user_id: assignee?.data?.user_id || task.user_id,
        type: 'task_due',
        contact_id: task.contact_id,
        title: 'Tarefa pendente',
        body: 'Uma tarefa chegou ao prazo. Confira no Organizap.',
        source_key: `task:${task.id}`,
      },
      { onConflict: 'source_key', ignoreDuplicates: true }
    );
  }
  const jobs = await db
    .from('notification_deliveries')
    .select('*')
    .is('processed_at', null)
    .lt('attempts', 3)
    .or(`locked_until.is.null,locked_until.lt.${new Date().toISOString()}`)
    .limit(30);
  if (jobs.error) throw jobs.error;
  for (const job of jobs.data ?? []) {
    const claim = await db
      .from('notification_deliveries')
      .update({
        locked_until: new Date(Date.now() + 120_000).toISOString(),
        attempts: job.attempts + 1,
      })
      .eq('notification_id', job.notification_id)
      .eq('attempts', job.attempts)
      .select('notification_id');
    if (!claim.data?.length) continue;
    try {
      const { data: n } = await db
        .from('notifications')
        .select('*')
        .eq('id', job.notification_id)
        .single();
      if (!n) continue;
      const [{ data: p }, { data: member }] = await Promise.all([
        db
          .from('notification_preferences')
          .select('settings')
          .eq('user_id', n.user_id)
          .eq('account_id', n.account_id)
          .maybeSingle(),
        db
          .from('profiles')
          .select('user_id')
          .eq('user_id', n.user_id)
          .eq('account_id', n.account_id)
          .maybeSingle(),
      ]);
      const s = p?.settings ?? {};
      const category =
        n.type === 'new_message'
          ? 'messages'
          : n.type === 'task_due'
            ? 'tasks'
            : n.type === 'sale_won'
              ? 'sales'
              : 'system';
      if (!member || !s[category]) {
        await db
          .from('notification_deliveries')
          .update({ processed_at: new Date().toISOString() })
          .eq('notification_id', n.id);
        continue;
      }
      const quiet = isQuiet(s);
      let pushSent = job.push_sent,
        whatsappSent = job.whatsapp_sent;
      if (!pushSent && !(quiet && s.quietPush)) {
        const subscriptions = await db
          .from('push_subscriptions')
          .select('*')
          .eq('user_id', n.user_id)
          .eq('account_id', n.account_id);
        if (
          subscriptions.data?.length &&
          process.env.VAPID_PUBLIC_KEY &&
          process.env.VAPID_PRIVATE_KEY
        ) {
          webpush.setVapidDetails(
            'https://organizap.tpxdigital.com',
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
          );
          for (const sub of subscriptions.data) {
            const endpoint = new URL(sub.subscription.endpoint);
            if (
              endpoint.protocol !== 'https:' ||
              endpoint.port ||
              endpoint.username ||
              endpoint.password ||
              !(
                [
                  'fcm.googleapis.com',
                  'updates.push.services.mozilla.com',
                  'web.push.apple.com',
                ].includes(endpoint.hostname) ||
                endpoint.hostname.endsWith('.notify.windows.com')
              )
            )
              continue;
            try {
              await webpush.sendNotification(
                sub.subscription,
                JSON.stringify({
                  title: 'Organizap',
                  body:
                    n.type === 'new_message'
                      ? 'Você recebeu uma nova mensagem.'
                      : n.title,
                  url: n.conversation_id
                    ? `/inbox?c=${n.conversation_id}`
                    : n.type === 'task_due'
                      ? '/tasks'
                      : '/notifications',
                  tag: n.id,
                }),
                { TTL: 3600, timeout: 5000 }
              );
            } catch (e) {
              if ([404, 410].includes((e as { statusCode: number }).statusCode))
                await db.from('push_subscriptions').delete().eq('id', sub.id);
              else throw e;
            }
          }
        }
        pushSent = true;
        await db
          .from('notification_deliveries')
          .update({ push_sent: true })
          .eq('notification_id', n.id);
      }
      if (!whatsappSent && (!s.whatsapp || n.type !== 'task_due'))
        whatsappSent = true;
      if (!whatsappSent && !quiet && /^\d{8,15}$/.test(s.phone ?? '')) {
        const response = await fetchQrConnector(n.account_id, 'messages/send', {
          method: 'POST',
          body: JSON.stringify({
            phone: s.phone,
            text: 'Organizap: você tem uma tarefa pendente. Acesse https://organizap.tpxdigital.com/tasks',
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error('WhatsApp reminder failed');
        whatsappSent = true;
      }
      await db
        .from('notification_deliveries')
        .update({
          push_sent: pushSent,
          whatsapp_sent: whatsappSent,
          processed_at:
            pushSent && whatsappSent ? new Date().toISOString() : null,
          attempts: pushSent && whatsappSent ? job.attempts + 1 : job.attempts,
          locked_until:
            pushSent && whatsappSent
              ? null
              : new Date(Date.now() + 60_000).toISOString(),
        })
        .eq('notification_id', n.id);
    } catch {
      await db
        .from('notification_deliveries')
        .update({ locked_until: null })
        .eq('notification_id', job.notification_id);
    }
  }
  return { processed: jobs.data?.length ?? 0 };
}
