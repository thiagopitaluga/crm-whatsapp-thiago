-- Make Brazilian Real the default for new workspaces and normalize the
-- existing workspaces configured with the previous global USD default.
ALTER TABLE public.accounts
  ALTER COLUMN default_currency SET DEFAULT 'BRL';

UPDATE public.accounts
SET default_currency = 'BRL'
WHERE default_currency = 'USD';
