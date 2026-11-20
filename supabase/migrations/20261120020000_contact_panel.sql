begin;
alter table public.contacts add column document_number text, add column birth_date date,
 add column address jsonb not null default '{}', add column company_details jsonb not null default '{}',
 add column temperature text check(temperature in ('cold','warm','hot'));
alter table public.contact_notes add column note_type text not null default 'general' check(note_type in ('general','test','problem'));
alter table public.deals add column temperature text check(temperature in ('cold','warm','hot'));
create table public.deal_custom_values (
 id uuid primary key default gen_random_uuid(), deal_id uuid not null references public.deals(id) on delete cascade,
 custom_field_id uuid not null references public.custom_fields(id) on delete cascade, value text,
 unique(deal_id,custom_field_id)
);
alter table public.deal_custom_values enable row level security;
create policy deal_values_read on public.deal_custom_values for select to authenticated using(exists(select 1 from public.deals d where d.id=deal_id));
create policy deal_values_write on public.deal_custom_values for all to authenticated using(exists(select 1 from public.deals d where d.id=deal_id and public.is_account_member(d.account_id,'agent'))) with check(exists(select 1 from public.deals d join public.custom_fields f on f.id=custom_field_id and f.account_id=d.account_id where d.id=deal_id and public.is_account_member(d.account_id,'agent')));
create table public.contact_meetings (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade, user_id uuid not null references auth.users(id),
 title text not null check(length(trim(title))>0), starts_at timestamptz not null, ends_at timestamptz not null,
 location text, status text not null default 'scheduled' check(status in ('scheduled','cancelled','completed')),
 created_at timestamptz not null default now(), check(ends_at>starts_at)
);
alter table public.contact_meetings enable row level security;
create policy meetings_read on public.contact_meetings for select to authenticated using(exists(select 1 from public.contacts c where c.id=contact_id and c.account_id=contact_meetings.account_id));
create policy meetings_write on public.contact_meetings for all to authenticated using(public.is_account_member(account_id,'agent') and exists(select 1 from public.contacts c where c.id=contact_id and c.account_id=contact_meetings.account_id)) with check(user_id=auth.uid() and public.is_account_member(account_id,'agent') and exists(select 1 from public.contacts c where c.id=contact_id and c.account_id=contact_meetings.account_id));
commit;
