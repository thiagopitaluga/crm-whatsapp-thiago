/** Only these in-app destinations are allowed after OAuth. */
export function instagramConnectionReturnPath(value: unknown) {
  return value === 'connections' ? '/connections?tab=instagram' : '/instagram';
}
