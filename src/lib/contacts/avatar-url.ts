export function whatsappAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname.endsWith('.whatsapp.net') ||
        url.hostname.endsWith('.fbcdn.net'))
      ? url.href
      : null;
  } catch {
    return null;
  }
}
