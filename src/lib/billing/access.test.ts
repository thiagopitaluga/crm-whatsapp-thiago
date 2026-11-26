import { describe, expect, it } from 'vitest';
import { parseAccessForm, serviceFeatures, serviceLimits } from './access';
import { serviceFeatureForPath } from './feature-path';

function accessForm() {
  const data = new FormData();
  Object.keys(serviceFeatures).forEach((key) =>
    data.set('feature_' + key, 'plan')
  );
  Object.keys(serviceLimits).forEach((key) => data.set('limit_' + key, ''));
  return data;
}

describe('personalização de acesso', () => {
  it('permite voltar ao plano e distingue zero de ilimitado', () => {
    const form = accessForm();
    form.set('limit_users', '0');
    form.set('limit_whatsapp', 'unlimited');
    form.set('feature_instagram', 'enabled');
    form.set('feature_groupAutomation', 'disabled');
    form.set('complimentary', 'on');
    expect(parseAccessForm(form)).toEqual({
      complimentary: true,
      limits: { users: 0, whatsapp: null },
      features: { instagram: true, groupAutomation: false },
    });
    expect(parseAccessForm(accessForm())).toEqual({
      complimentary: false,
      limits: {},
      features: {},
    });
  });
  it('rejeita limites negativos e escolhas desconhecidas', () => {
    const form = accessForm();
    form.set('limit_users', '-1');
    expect(() => parseAccessForm(form)).toThrow();
    form.set('limit_users', '');
    form.set('feature_instagram', 'anything');
    expect(() => parseAccessForm(form)).toThrow();
  });
  it('protege subrotas sem bloquear webhooks e cron autenticados pelo servidor', () => {
    expect(serviceFeatureForPath('/api/instagram/conversations')).toBe(
      'instagram'
    );
    expect(
      serviceFeatureForPath('/api/whatsapp/group-broadcasts/123/retry')
    ).toBe('groupAutomation');
    expect(serviceFeatureForPath('/api/instagram/webhook')).toBeUndefined();
    expect(serviceFeatureForPath('/api/instagram/cron')).toBeUndefined();
    expect(serviceFeatureForPath('/api/instagram/connect')).toBeUndefined();
    expect(serviceFeatureForPath('/thiago/assinaturas')).toBeUndefined();
  });
});
