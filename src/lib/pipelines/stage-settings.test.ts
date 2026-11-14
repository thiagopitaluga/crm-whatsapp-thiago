import { describe, expect, it } from 'vitest';
import {
  defaultStageSettings,
  validateStageSettings,
  renderStageTemplate,
} from './stage-settings';

describe('stage settings validation', () => {
  it('accepts disabled defaults', () =>
    expect(validateStageSettings(defaultStageSettings())).toBeNull());
  it.each([null, [], {}, { ai: {} }])('rejects malformed payload %j', (value) =>
    expect(validateStageSettings(value)).not.toBeNull()
  );
  it('rejects a malformed null trigger without throwing', () => {
    const settings = defaultStageSettings();
    (settings as unknown as { rules: unknown[] }).rules = [null];
    expect(validateStageSettings(settings)).not.toBeNull();
  });
  it('requires a custom instruction before enabling AI', () => {
    const settings = defaultStageSettings();
    settings.ai.enabled = true;
    settings.ai.condition = 'custom';
    expect(validateStageSettings(settings)).toMatch(/Descreva/);
  });
  it('rejects unknown Meta events', () => {
    const settings = defaultStageSettings();
    settings.metaEvent = 'arbitrary';
    expect(validateStageSettings(settings)).toMatch(/Meta/);
  });
  it('requires email content and rejects injected recipient headers', () => {
    const settings = defaultStageSettings();
    settings.email.recipients = 'sales@example.com';
    expect(validateStageSettings(settings)).toMatch(/assunto/);
    settings.email = {
      recipients: 'sales@example.com\nBcc: evil@example.com',
      subject: 'Hi',
      html: 'Hello',
    };
    expect(validateStageSettings(settings)).not.toBeNull();
  });
  it('rejects duplicate trigger IDs and unsafe delays', () => {
    const settings = defaultStageSettings();
    const rule = {
      id: 'r1',
      name: 'Welcome',
      enabled: true,
      event: 'entered' as const,
      hours: 24,
      action: 'message' as const,
      value: 'Hello',
    };
    settings.rules = [rule, { ...rule }];
    expect(validateStageSettings(settings)).not.toBeNull();
    settings.rules = [{ ...rule, hours: -1 }];
    expect(validateStageSettings(settings)).not.toBeNull();
  });
  it('escapes contact HTML while retaining the administrator template', () => {
    expect(
      renderStageTemplate(
        '<b>{contact.name}</b>',
        { 'contact.name': '<img src=x onerror=x>' },
        true
      )
    ).toBe('<b>&lt;img src=x onerror=x&gt;</b>');
    expect(
      renderStageTemplate('Olá {contact.name}', {
        'contact.name': 'Ana & João',
      })
    ).toBe('Olá Ana & João');
  });
});
