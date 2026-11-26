export const serviceFeatures = {
  inbox: 'Caixa de entrada',
  contacts: 'Contatos',
  pipelines: 'Funis',
  tasks: 'Tarefas',
  instagram: 'Instagram',
  groupAutomation: 'Automações de grupos',
  groups: 'Visualização de grupos',
  metaAds: 'Meta Ads e relatórios',
  ai: 'Agentes de IA',
  automations: 'Automações',
  broadcasts: 'Disparos',
} as const;

export const serviceLimits = {
  users: 'Usuários',
  whatsapp: 'WhatsApps',
  instagram: 'Perfis de Instagram',
  funnels: 'Funis',
} as const;
export type ServiceAccess = {
  complimentary: boolean;
  features: Partial<Record<keyof typeof serviceFeatures, boolean>>;
  limits: Partial<Record<keyof typeof serviceLimits, number | null>>;
};

export function parseAccessForm(data: FormData): ServiceAccess {
  const features: ServiceAccess['features'] = {};
  const limits: ServiceAccess['limits'] = {};
  for (const key of Object.keys(
    serviceFeatures
  ) as (keyof typeof serviceFeatures)[]) {
    const value = data.get('feature_' + key);
    if (value === 'enabled' || value === 'disabled')
      features[key] = value === 'enabled';
    else if (value !== 'plan') throw new Error('Recurso inválido.');
  }
  for (const key of Object.keys(
    serviceLimits
  ) as (keyof typeof serviceLimits)[]) {
    const value = data.get('limit_' + key);
    if (value === '') continue;
    if (value === 'unlimited') {
      limits[key] = null;
      continue;
    }
    if (typeof value !== 'string' || !/^\d{1,7}$/.test(value))
      throw new Error(
        'Limite inválido. Use um número, unlimited ou deixe vazio.'
      );
    limits[key] = Number(value);
  }
  return {
    complimentary: data.get('complimentary') === 'on',
    features,
    limits,
  };
}
