'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Contact, CustomField } from '@/types';
import {
  selectedValues,
  validateCustomValue,
} from '@/lib/contacts/custom-values';

export const FIELD_TYPES = [
  ['text', 'Texto curto'],
  ['textarea', 'Texto longo'],
  ['number', 'Número'],
  ['decimal', 'Decimal (R$)'],
  ['date', 'Data'],
  ['datetime', 'Data + hora'],
  ['select', 'Seleção única (lista)'],
  ['multiselect', 'Seleção múltipla'],
  ['boolean', 'Sim / Não'],
  ['email', 'Email'],
  ['phone', 'Telefone'],
  ['url', 'URL'],
] as const;
const control =
  'bg-background w-full min-w-0 rounded-md border px-2 py-1.5 text-xs';
export type ExtendedContact = Contact & {
  document_number?: string;
  birth_date?: string;
  address?: Record<string, string>;
  company_details?: Record<string, string>;
  temperature?: string | null;
};

export function EditableValue({
  label,
  value,
  type = 'text',
  options = [],
  disabled = false,
  onSave,
}: {
  label: string;
  value: string;
  type?: string;
  options?: string[];
  disabled?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(value),
    [busy, setBusy] = useState(false);
  const props = {
    value: draft,
    onChange: (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) => setDraft(e.target.value),
    className: control,
    'aria-label': label,
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(validateCustomValue(type, draft, options));
      setEditing(false);
    } catch (e) {
      toast.error((e as Error).message || 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-border/50 grid grid-cols-[90px_minmax(0,1fr)] items-start gap-2 border-b px-3 py-2 text-xs">
      <span className="text-muted-foreground pt-1">{label}</span>
      {editing ? (
        <form onSubmit={save} className="min-w-0 space-y-2">
          {type === 'textarea' ? (
            <textarea {...props} rows={3} />
          ) : type === 'select' || type === 'boolean' ? (
            <select {...props}>
              <option value="">—</option>
              {(type === 'boolean' ? ['Sim', 'Não'] : options).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : type === 'multiselect' ? (
            <select
              multiple
              aria-label={label}
              className={control}
              value={selectedValues(draft)}
              onChange={(e) =>
                setDraft(
                  JSON.stringify(
                    Array.from(e.target.selectedOptions, (o) => o.value)
                  )
                )
              }
            >
              {options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              {...props}
              step={
                type === 'decimal'
                  ? '0.01'
                  : type === 'number'
                    ? '1'
                    : undefined
              }
              type={
                type === 'datetime'
                  ? 'datetime-local'
                  : type === 'decimal' || type === 'number'
                    ? 'number'
                    : type === 'phone'
                      ? 'tel'
                      : ['date', 'email', 'url'].includes(type)
                        ? type
                        : 'text'
              }
            />
          )}
          <div className="flex gap-1">
            <Button size="sm" type="submit" disabled={busy}>
              Salvar
            </Button>
            <button
              type="button"
              className="text-muted-foreground"
              onClick={() => setEditing(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button
          disabled={disabled}
          className="text-primary disabled:text-foreground min-w-0 py-1 text-left break-words"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          {value
            ? type === 'multiselect'
              ? (() => {
                  try {
                    return JSON.parse(value).join(', ');
                  } catch {
                    return value;
                  }
                })()
              : value
            : '— adicionar —'}
        </button>
      )}
    </div>
  );
}

export function ContactDataPanel({
  contact,
  dealId,
  onUpdated,
}: {
  contact: ExtendedContact;
  dealId?: string;
  onUpdated: () => void;
}) {
  const { accountId, user, canEditSettings, canSendMessages } = useAuth();
  const [fields, setFields] = useState<CustomField[]>([]),
    [values, setValues] = useState<Record<string, string>>({}),
    [refresh, setRefresh] = useState(0),
    [showAll, setShowAll] = useState(false);
  const [scope, setScope] = useState<'lead' | 'contact' | null>(null),
    [name, setName] = useState(''),
    [type, setType] = useState('text'),
    [pinned, setPinned] = useState(true),
    [options, setOptions] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const db = createClient();
    void Promise.all([
      db
        .from('custom_fields')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at'),
      db
        .from('contact_custom_values')
        .select('custom_field_id,value')
        .eq('contact_id', contact.id),
      dealId
        ? db
            .from('deal_custom_values')
            .select('custom_field_id,value')
            .eq('deal_id', dealId)
        : Promise.resolve({ data: [], error: null }),
    ]).then(([f, c, d]) => {
      if (cancelled) return;
      setError(!!(f.error || c.error || d.error));
      setFields(f.data ?? []);
      setValues(
        Object.fromEntries(
          [...(c.data ?? []), ...(d.data ?? [])].map((v) => [
            v.custom_field_id,
            v.value ?? '',
          ])
        )
      );
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, contact.id, dealId, refresh]);
  async function update(key: string, value: unknown) {
    const r = await createClient()
      .from('contacts')
      .update({ [key]: value || null })
      .eq('id', contact.id)
      .eq('account_id', accountId!);
    if (r.error) throw r.error;
    onUpdated();
  }
  async function createField(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !user || !accountId) return;
    const choices = options
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (['select', 'multiselect'].includes(type) && !choices.length) {
      toast.error('Informe pelo menos uma opção.');
      return;
    }
    setBusy(true);
    const r = await createClient()
      .from('custom_fields')
      .insert({
        user_id: user.id,
        account_id: accountId,
        field_name: name.trim(),
        field_type: type,
        field_options: { scope, pinned, options: choices },
      });
    setBusy(false);
    if (r.error) {
      toast.error('Não foi possível criar o campo.');
      return;
    }
    setScope(null);
    setName('');
    setOptions('');
    setRefresh((v) => v + 1);
  }
  const row = (label: string, key: keyof ExtendedContact, type = 'text') => (
    <EditableValue
      key={`${contact.id}-${key}-${String(contact[key] ?? '')}`}
      label={label}
      value={String(contact[key] ?? '')}
      type={type}
      disabled={!canSendMessages}
      onSave={(v) => update(key, v)}
    />
  );
  const nested = (
    label: string,
    key: string,
    group: 'address' | 'company_details'
  ) => (
    <EditableValue
      key={`${key}-${contact[group]?.[key] ?? ''}`}
      label={label}
      value={contact[group]?.[key] ?? ''}
      disabled={!canSendMessages}
      onSave={(v) => update(group, { ...contact[group], [key]: v })}
    />
  );
  return (
    <div className="space-y-4 p-3">
      <section className="overflow-hidden rounded-xl border">
        <h4 className="border-b p-3 text-xs font-semibold">CONTATO</h4>
        {row('Nome', 'name')}
        {row('Telefone', 'phone', 'phone')}
        {row('Email', 'email', 'email')}
        {row('CPF/CNPJ', 'document_number')}
        {row('Nascimento', 'birth_date', 'date')}
        <details>
          <summary className="cursor-pointer p-3 text-xs">Endereço</summary>
          {[
            ['CEP', 'zip'],
            ['Rua', 'street'],
            ['Número', 'number'],
            ['Complemento', 'complement'],
            ['Bairro', 'district'],
            ['Cidade', 'city'],
            ['Estado', 'state'],
          ].map(([label, key]) => nested(label, key, 'address'))}
        </details>
      </section>
      <details className="overflow-hidden rounded-xl border">
        <summary className="cursor-pointer p-3 text-xs font-semibold">
          EMPRESA (OPCIONAL)
        </summary>
        {row('Nome', 'company')}
        {[
          ['CNPJ', 'document'],
          ['Razão social', 'legal_name'],
          ['Email', 'email'],
          ['Telefone', 'phone'],
          ['Site', 'website'],
          ['Endereço', 'address'],
        ].map(([label, key]) => nested(label, key, 'company_details'))}
      </details>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          Não foi possível carregar todos os campos.{' '}
          <button onClick={() => setRefresh((v) => v + 1)}>
            Tentar novamente
          </button>
        </p>
      )}
      {(['lead', 'contact'] as const).map((group) => (
        <section key={group} className="overflow-hidden rounded-xl border">
          <header className="flex items-center justify-between gap-2 p-3">
            <h4 className="text-xs font-semibold">
              {group === 'lead' ? 'Campos do Lead' : 'Campos personalizados'}
            </h4>
            <Button
              size="sm"
              variant="outline"
              disabled={!canEditSettings || (group === 'lead' && !dealId)}
              title={
                !canEditSettings
                  ? 'Somente administradores podem criar campos'
                  : undefined
              }
              onClick={() => {
                setScope(group);
                setType('text');
                setPinned(true);
              }}
            >
              + Novo
            </Button>
          </header>
          {group === 'lead' && !dealId ? (
            <p className="text-muted-foreground px-3 pb-3 text-xs">
              Adicione um negócio ao contato para preencher campos do lead.
            </p>
          ) : (
            fields
              .filter(
                (f) =>
                  (f.field_options?.scope ?? 'contact') === group &&
                  (showAll || f.field_options?.pinned !== false)
              )
              .map((f) => (
                <EditableValue
                  key={`${f.id}-${values[f.id] ?? ''}`}
                  label={f.field_name}
                  value={values[f.id] ?? ''}
                  type={f.field_type}
                  options={
                    Array.isArray(f.field_options?.options)
                      ? (f.field_options.options as string[])
                      : []
                  }
                  disabled={!canSendMessages}
                  onSave={async (value) => {
                    const lead = group === 'lead';
                    const r = await createClient()
                      .from(
                        lead ? 'deal_custom_values' : 'contact_custom_values'
                      )
                      .upsert(
                        {
                          [lead ? 'deal_id' : 'contact_id']: lead
                            ? dealId
                            : contact.id,
                          custom_field_id: f.id,
                          value,
                        },
                        {
                          onConflict: lead
                            ? 'deal_id,custom_field_id'
                            : 'contact_id,custom_field_id',
                        }
                      );
                    if (r.error) throw r.error;
                    setValues((v) => ({ ...v, [f.id]: value }));
                  }}
                />
              ))
          )}
          {!fields.some(
            (f) => (f.field_options?.scope ?? 'contact') === group
          ) && (
            <p className="text-muted-foreground px-3 pb-3 text-xs">
              Nenhum campo cadastrado.
            </p>
          )}
        </section>
      ))}
      <button
        className="text-primary text-xs"
        onClick={() => setShowAll((v) => !v)}
      >
        {showAll ? 'Mostrar só campos fixados' : 'Mostrar todos os campos'}
      </button>
      <Dialog
        open={!!scope}
        onOpenChange={(open) => {
          if (!open) setScope(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Novo campo personalizado ({scope === 'lead' ? 'Lead' : 'Contato'})
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={createField} className="space-y-4">
            <label className="block text-sm">
              Nome do campo
              <input
                required
                maxLength={150}
                className={`${control} mt-1`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Tipo
              <select
                className={`${control} mt-1`}
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {FIELD_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {['select', 'multiselect'].includes(type) && (
              <label className="block text-sm">
                Opções (uma por linha)
                <textarea
                  required
                  className={`${control} mt-1`}
                  rows={4}
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                />
              </label>
            )}
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              Fixar no painel
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setScope(null)}
              >
                Cancelar
              </Button>
              <Button disabled={busy || !name.trim()}>Criar campo</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
