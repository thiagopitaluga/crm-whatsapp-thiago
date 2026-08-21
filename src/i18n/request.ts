import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  // This customized deployment is Brazilian Portuguese by default.
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'pt-BR';

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
