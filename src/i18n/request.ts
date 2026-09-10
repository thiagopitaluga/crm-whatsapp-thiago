import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

const SUPPORTED_LOCALES = new Set(['pt-BR', 'en']);
const LOCALE_COOKIE = 'wacrm.locale';

export default getRequestConfig(async () => {
  // The workspace default is configured at deploy time, while each user can
  // override it from the header. A cookie keeps that choice across reloads.
  const configuredLocale = process.env.NEXT_PUBLIC_APP_LOCALE || 'pt-BR';
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = SUPPORTED_LOCALES.has(cookieLocale ?? '')
    ? cookieLocale!
    : configuredLocale;

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    // Keep the customized CRM usable even if an invalid locale is configured.
    messages = (await import('../../messages/pt-BR.json')).default;
  }

  return {
    locale,
    messages
  };
});
