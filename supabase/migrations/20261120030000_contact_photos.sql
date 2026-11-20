alter table public.contacts add column avatar_checked_at timestamptz;
notify pgrst, 'reload schema';
