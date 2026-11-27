const featurePaths: Record<string, string[]> = {
  inbox: ['/inbox', '/api/conversations', '/api/messages'],
  contacts: ['/contacts', '/api/contacts'],
  pipelines: ['/pipelines', '/api/pipelines'],
  tasks: ['/tasks', '/api/tasks'],
  instagram: ['/instagram', '/api/instagram'],
  groupAutomation: ['/api/whatsapp/group-broadcasts'],
  groups: ['/groups', '/api/whatsapp/groups'],
  metaAds: ['/meta-ads', '/api/meta-ads'],
  ai: ['/agents', '/api/ai'],
  automations: ['/automations', '/flows', '/api/automations', '/api/flows'],
  broadcasts: ['/broadcasts', '/api/whatsapp/broadcast', '/api/whatsapp/evolution-campaigns'],
};
export function serviceFeatureForPath(path: string): string | undefined {
  if (
    path.includes('/webhook') ||
    path.endsWith('/cron') ||
    path.startsWith('/api/instagram/connect') ||
    path.startsWith('/api/meta-ads/connect')
  )
    return undefined;
  return Object.entries(featurePaths).find(([, paths]) =>
    paths.some((prefix) => path === prefix || path.startsWith(prefix + '/'))
  )?.[0];
}
