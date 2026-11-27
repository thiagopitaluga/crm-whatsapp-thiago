BEGIN;
ALTER TABLE public.notification_preferences DROP CONSTRAINT notification_preferences_pkey;
ALTER TABLE public.notification_preferences ADD PRIMARY KEY (user_id, account_id);
NOTIFY pgrst, 'reload schema';
COMMIT;
