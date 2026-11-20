begin;
create table public.notification_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 account_id uuid not null references public.accounts(id) on delete cascade,
 settings jsonb not null default '{}'
);
alter table public.notification_preferences enable row level security;
create policy preferences_own on public.notification_preferences for all to authenticated
 using(user_id=auth.uid() and public.is_account_member(account_id))
 with check(user_id=auth.uid() and public.is_account_member(account_id));
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null references public.accounts(id) on delete cascade,
 endpoint text not null unique, subscription jsonb not null, created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy subscriptions_own on public.push_subscriptions for all to authenticated
 using(user_id=auth.uid() and public.is_account_member(account_id))
 with check(user_id=auth.uid() and public.is_account_member(account_id));
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in ('conversation_assigned','group_broadcast','ai_agent_trigger','new_message','task_due','sale_won','system'));
alter table public.notifications add column source_key text unique;
create table public.notification_deliveries (
 notification_id uuid primary key references public.notifications(id) on delete cascade,
 processed_at timestamptz, push_sent boolean not null default false, whatsapp_sent boolean not null default false, locked_until timestamptz, attempts int not null default 0
);
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon, authenticated;
create function public.enqueue_mobile_notification() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into notification_deliveries(notification_id) values(new.id); return new; end $$;
create trigger enqueue_mobile_notification after insert on public.notifications for each row execute function public.enqueue_mobile_notification();
create function public.notify_incoming_mobile() returns trigger language plpgsql security definer set search_path=public as $$
declare c record;
begin
 if new.sender_type <> 'customer' then return new; end if;
 select * into c from conversations where id=new.conversation_id;
 insert into notifications(account_id,user_id,type,conversation_id,contact_id,title,body,source_key)
 select c.account_id,p.user_id,'new_message',c.id,c.contact_id,'Nova mensagem no Organizap','Um contato respondeu. Abra a conversa para ver.',new.id::text||':'||p.user_id::text
 from notification_preferences p
 where p.account_id=c.account_id
 and exists(select 1 from profiles pr where pr.user_id=p.user_id and pr.account_id=c.account_id)
 and (c.assigned_agent_id=p.user_id or c.assigned_agent_id is null)
 and p.settings->>'messages'='true'
 and (p.settings->>'allMessages'='true' or c.assigned_agent_id is not null or c.ai_autoreply_disabled is true)
 on conflict(source_key) do nothing;
 return new;
end $$;
create trigger notify_incoming_mobile after insert on public.messages for each row execute function public.notify_incoming_mobile();
revoke all on function public.enqueue_mobile_notification() from public, anon, authenticated;
revoke all on function public.notify_incoming_mobile() from public, anon, authenticated;
create function public.notify_sale_mobile() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='won' and (tg_op='INSERT' or old.status is distinct from new.status) then
  insert into notifications(account_id,user_id,type,contact_id,title,body)
  select new.account_id,p.user_id,'sale_won',new.contact_id,'Venda ganha','Um negócio foi marcado como ganho no Organizap.'
  from notification_preferences p join profiles pr on pr.user_id=p.user_id and pr.account_id=new.account_id
  where p.account_id=new.account_id and p.settings->>'sales'='true';
 end if; return new;
end $$;
create trigger notify_sale_mobile after insert or update of status on public.deals for each row execute function public.notify_sale_mobile();
revoke all on function public.notify_sale_mobile() from public, anon, authenticated;
commit;
