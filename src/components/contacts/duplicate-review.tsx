'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

type Candidate = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
};
type Group = { email: string; contacts: Candidate[] };

export function DuplicateReview({
  accountId,
  onOpen,
}: {
  accountId: string;
  onOpen: (id: string) => void;
}) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function scan() {
    setLoading(true);
    setError('');
    const db = createClient();
    const byEmail = new Map<string, Candidate[]>();
    try {
      for (let offset = 0; ; offset += 500) {
        const { data, error: queryError } = await db
          .from('contacts')
          .select('id,name,phone,email')
          .eq('account_id', accountId)
          .not('email', 'is', null)
          .order('id')
          .range(offset, offset + 499);
        if (queryError) throw queryError;
        for (const contact of data ?? []) {
          const email = contact.email?.trim().toLowerCase();
          if (!email) continue;
          const group = byEmail.get(email) ?? [];
          group.push(contact);
          byEmail.set(email, group);
        }
        if (!data || data.length < 500) break;
        if (offset >= 9500)
          throw new Error(
            'A conta tem mais de 10 mil contatos com e-mail. A busca precisa ser feita no banco.'
          );
      }
      setGroups(
        [...byEmail]
          .filter(([, contacts]) => contacts.length > 1)
          .map(([email, contacts]) => ({ email, contacts }))
      );
    } catch (cause) {
      setGroups(null);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível buscar duplicados.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <details className="bg-card rounded-xl border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Possíveis contatos duplicados
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground text-xs">
          Encontre contatos visíveis com o mesmo e-mail e abra cada cadastro
          para revisar.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void scan()}
        >
          <Copy className="size-3.5" />{' '}
          {loading ? 'Buscando…' : 'Buscar por e-mail repetido'}
        </Button>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        {groups && (
          <p className="text-muted-foreground text-sm" role="status">
            {groups.length
              ? `${groups.length} e-mail(s) repetido(s)`
              : 'Nenhum e-mail repetido encontrado.'}
          </p>
        )}
        {Boolean(groups?.length) && (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {groups?.map(({ email, contacts }) => (
              <li key={email} className="rounded-lg border p-2">
                <p className="text-xs font-medium break-all">{email}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {contacts.map((contact) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      key={contact.id}
                      onClick={() => onOpen(contact.id)}
                    >
                      {contact.name || 'Sem nome'}
                      {contact.phone ? ` · ${contact.phone}` : ''}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
