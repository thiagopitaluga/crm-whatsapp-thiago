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
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { formatCurrency } from '@/lib/currency';
import { ContactAttribution } from './contact-attribution';
import { EditableValue, type ExtendedContact } from './contact-data-panel';
import { ContactSidebarSections } from './contact-sidebar-sections';
import type {
  ContactNote,
  Tag,
  Deal,
  PipelineStage,
  Conversation,
} from '@/types';

type FormSubmission = {
  id: string;
  source_type: string;
  submitted_at: string | null;
  created_at: string;
  fields: Record<string, unknown>;
};
type Member = { id: string; full_name: string | null; email: string };
type Note = ContactNote & { note_type: string };
type Meeting = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  status: string;
};
const control =
  'bg-background min-w-0 w-full rounded-md border px-2 py-1.5 text-xs';
const heading =
  'text-muted-foreground text-xs font-semibold uppercase tracking-wide';
const dt = (date: string) => new Date(date).toLocaleString('pt-BR');
export function ContactOverview({
  contact,
  conversation,
  deals,
  selectedDeal,
  onSelectDeal,
  onUpdated,
}: {
  contact: ExtendedContact;
  conversation: Conversation | null;
  deals: Deal[];
  selectedDeal?: Deal;
  onSelectDeal: (id: string) => void;
  onUpdated: () => void;
}) {
  const { accountId, user, canSendMessages, defaultCurrency } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]),
    [allTags, setAllTags] = useState<Tag[]>([]),
    [tags, setTags] = useState<Tag[]>([]),
    [forms, setForms] = useState<FormSubmission[]>([]),
    [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]),
    [stages, setStages] = useState<PipelineStage[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [meetings, setMeetings] = useState<Meeting[]>([]);
  const [text, setText] = useState(''),
    [noteType, setNoteType] = useState('general'),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false),
    [draft, setDraft] = useState(''),
    [meetingOpen, setMeetingOpen] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState(
      'Reunião com ' + (contact.name || contact.phone)
    ),
    [meetingDate, setMeetingDate] = useState(''),
    [duration, setDuration] = useState(30),
    [location, setLocation] = useState('');
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const db = createClient();
    void Promise.all([
      db
        .from('contact_notes')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      db.from('tags').select('*').eq('account_id', accountId).order('name'),
      db.from('contact_tags').select('tag_id').eq('contact_id', contact.id),
      db
        .from('lead_form_submissions')
        .select('id,source_type,submitted_at,created_at,fields')
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      db
        .from('pipelines')
        .select('id,name')
        .eq('account_id', accountId)
        .order('name'),
      db.from('pipeline_stages').select('*').order('position'),
      db
        .from('profiles')
        .select('id,full_name,email')
        .eq('account_id', accountId)
        .order('full_name'),
      db
        .from('contact_meetings')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .order('starts_at', { ascending: false }),
    ]).then(([n, t, ct, f, p, s, m, meet]) => {
      if (cancelled) return;
      setError(
        !!(
          n.error ||
          t.error ||
          ct.error ||
          f.error ||
          p.error ||
          s.error ||
          m.error ||
          meet.error
        )
      );
      setNotes(n.data ?? []);
      setAllTags(t.data ?? []);
      setTags(
        (t.data ?? []).filter((tag) =>
          ct.data?.some((row) => row.tag_id === tag.id)
        )
      );
      setForms(f.data ?? []);
      setPipelines(p.data ?? []);
      setStages(s.data ?? []);
      setMembers(m.data ?? []);
      setMeetings(meet.data ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, contact.id, refresh]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      setRefresh((v) => v + 1);
      onUpdated();
    } catch (e) {
      toast.error((e as Error).message || 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  async function patchDeal(patch: Record<string, unknown>) {
    if (!selectedDeal) return;
    const r = await createClient()
      .from('deals')
      .update(patch)
      .eq('id', selectedDeal.id)
      .eq('account_id', accountId!);
    if (r.error) throw r.error;
    onUpdated();
  }
  async function stageChange(stageId: string) {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;
    const name = stage.name.toLowerCase();
    await patchDeal({
      stage_id: stage.id,
      status: ['won', 'ganho', 'ganhou'].includes(name)
        ? 'won'
        : ['lost', 'perdido'].includes(name)
          ? 'lost'
          : 'open',
    });
  }
  async function startAi() {
    setBusy(true);
    try {
      const response = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversation?.id,
          initiate: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setDraft(data.draft);
      setAiOpen(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const formNames: Record<string, string> = {
    email: 'Email',
    full_name: 'Nome completo',
    phone_number: 'Telefone',
    utm_source: 'UTM source',
    utm_medium: 'UTM medium',
    utm_campaign: 'UTM campaign',
    utm_content: 'UTM content',
    utm_term: 'UTM term',
  };
  return (
    <div className="space-y-5 p-3">
      {loading && (
        <p className="text-muted-foreground text-xs">Carregando informações…</p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          Algumas informações não foram carregadas.{' '}
          <button
            className="underline"
            onClick={() => setRefresh((v) => v + 1)}
          >
            Tentar novamente
          </button>
        </p>
      )}
      <section className="space-y-2">
        <h4 className={heading}>Observações ({notes.length})</h4>
        <textarea
          aria-label="Nova observação"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={control}
          rows={3}
          placeholder="Anote o que você testou, comportamentos observados e informações importantes…"
        />
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground mr-1">tipo:</span>
          {[
            ['general', 'Geral'],
            ['test', 'Teste'],
            ['problem', 'Problema'],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setNoteType(value)}
              aria-pressed={noteType === value}
              className={`rounded-full border px-2 py-1 ${noteType === value ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          className="w-full"
          size="sm"
          variant="outline"
          disabled={!canSendMessages || busy || !text.trim()}
          onClick={() =>
            void run(async () => {
              const r = await createClient().from('contact_notes').insert({
                contact_id: contact.id,
                account_id: accountId,
                user_id: user?.id,
                note_text: text.trim(),
                note_type: noteType,
              });
              if (r.error) throw r.error;
              setText('');
            })
          }
        >
          Adicionar observação
        </Button>
        {notes.map((note) => (
          <div key={note.id} className="bg-muted rounded-md p-2 text-xs">
            <p className="break-words whitespace-pre-wrap">{note.note_text}</p>
            <p className="text-muted-foreground mt-1 text-[10px]">
              {(
                {
                  general: 'Geral',
                  test: 'Teste',
                  problem: 'Problema',
                } as Record<string, string>
              )[note.note_type] || 'Geral'}{' '}
              · {dt(note.created_at)}
            </p>
          </div>
        ))}
      </section>
      <section className="space-y-1 text-xs">
        <h4 className={`${heading} mb-2`}>Contato</h4>
        <p className="break-all">☎ {contact.phone}</p>
        {contact.email && <p className="break-all">✉ {contact.email}</p>}
        <p>Canal: WhatsApp</p>
        <p>Desde: {new Date(contact.created_at).toLocaleDateString('pt-BR')}</p>
      </section>
      <section className="space-y-2">
        <h4 className={heading}>Tags</h4>
        <div className="flex flex-wrap gap-1">
          {!tags.length && (
            <p className="text-muted-foreground text-xs italic">Nenhuma tag</p>
          )}
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-full border px-2 py-1 text-xs"
              style={{ color: tag.color }}
            >
              {tag.name}
              <button
                aria-label={`Remover tag ${tag.name}`}
                disabled={!canSendMessages || busy}
                className="ml-1"
                onClick={() =>
                  void run(async () => {
                    await deleteContactTag(contact.id, tag.id);
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <select
          aria-label="Adicionar tag"
          className={control}
          value=""
          disabled={busy || !canSendMessages}
          onChange={(e) => {
            const id = e.target.value;
            if (id)
              void run(async () => {
                await addContactTag(contact.id, id);
              });
          }}
        >
          <option value="">+ Adicionar tag…</option>
          {allTags
            .filter((t) => !tags.some((ct) => ct.id === t.id))
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </section>
      <section className="space-y-2">
        <h4 className={heading}>Lead</h4>
        {deals.length > 1 && (
          <select
            aria-label="Negócio"
            className={control}
            value={selectedDeal?.id ?? ''}
            onChange={(e) => onSelectDeal(e.target.value)}
          >
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        )}
        <div className="overflow-hidden rounded-xl border">
          <div className="grid grid-cols-[90px_minmax(0,1fr)] items-center gap-2 p-3 text-xs">
            <span className="text-muted-foreground">Temperatura</span>
            <select
              aria-label="Temperatura do lead"
              className={control}
              value={selectedDeal?.temperature ?? ''}
              disabled={!selectedDeal || !canSendMessages || busy}
              title="Classificação manual do lead"
              onChange={(e) =>
                void run(async () => {
                  await patchDeal({ temperature: e.target.value || null });
                })
              }
            >
              <option value="">Não avaliada</option>
              <option value="cold">❄ Frio</option>
              <option value="warm">☀ Morno</option>
              <option value="hot">🔥 Quente</option>
            </select>
          </div>
          {selectedDeal ? (
            <>
              <div className="grid grid-cols-[90px_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Etapa</span>
                <select
                  aria-label="Etapa do lead"
                  className={control}
                  value={selectedDeal.stage_id}
                  disabled={busy || !canSendMessages}
                  onChange={(e) => void run(() => stageChange(e.target.value))}
                >
                  {stages
                    .filter((s) => s.pipeline_id === selectedDeal.pipeline_id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
                <span className="text-muted-foreground">Funil</span>
                <select
                  aria-label="Funil do lead"
                  className={control}
                  value={selectedDeal.pipeline_id}
                  disabled={busy || !canSendMessages}
                  onChange={(e) => {
                    const pipelineId = e.target.value;
                    const first = stages.find(
                      (s) => s.pipeline_id === pipelineId
                    );
                    if (!first) {
                      toast.error('Este funil ainda não possui etapas.');
                      return;
                    }
                    void run(() =>
                      patchDeal({
                        pipeline_id: pipelineId,
                        stage_id: first.id,
                        status: 'open',
                      })
                    );
                  }}
                >
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <EditableValue
                key={`${selectedDeal.id}-${selectedDeal.value}`}
                label="Valor"
                value={String(selectedDeal.value ?? 0)}
                type="decimal"
                disabled={!canSendMessages || busy}
                onSave={(v) => {
                  const n = Number(v);
                  if (!Number.isFinite(n) || n < 0)
                    throw Error('Informe um valor válido.');
                  return patchDeal({ value: n });
                }}
              />
              <p className="text-muted-foreground px-3 py-1 text-right text-[10px]">
                {formatCurrency(
                  selectedDeal.value,
                  selectedDeal.currency ?? defaultCurrency
                )}
              </p>
              <div className="grid grid-cols-[90px_minmax(0,1fr)] items-center gap-2 p-3 text-xs">
                <span className="text-muted-foreground">Responsável</span>
                <select
                  aria-label="Responsável pelo lead"
                  className={control}
                  value={selectedDeal.assigned_to ?? ''}
                  disabled={busy || !canSendMessages}
                  onChange={(e) =>
                    void run(() =>
                      patchDeal({ assigned_to: e.target.value || null })
                    )
                  }
                >
                  <option value="">Sem responsável</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || m.email}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">Criado</span>
                <span>
                  {new Date(selectedDeal.created_at).toLocaleDateString(
                    'pt-BR'
                  )}
                </span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground p-3 text-xs">
              Nenhum negócio vinculado a este contato.
            </p>
          )}
        </div>
      </section>
      <section className="space-y-2">
        <ContactAttribution contactId={contact.id} />
      </section>
      <section className="space-y-2">
        <h4 className={heading}>Respostas do formulário</h4>
        {!forms.length && (
          <p className="text-muted-foreground text-xs">
            Nenhuma resposta de formulário registrada.
          </p>
        )}
        {forms.map((form) => (
          <div key={form.id} className="overflow-hidden rounded-xl border">
            <p className="bg-muted px-3 py-2 text-xs">
              {form.source_type} · {dt(form.submitted_at || form.created_at)}
            </p>
            <dl className="space-y-2 p-3 text-xs">
              {Object.entries(form.fields).map(([key, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-[90px_minmax(0,1fr)] gap-2"
                >
                  <dt className="text-muted-foreground break-words">
                    {formNames[key] || key}
                  </dt>
                  <dd className="break-words">
                    {typeof value === 'string' ? value : JSON.stringify(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <dl className="bg-muted space-y-1 rounded-lg p-3 text-[11px]">
          <div className="flex justify-between gap-2">
            <dt>Primeira interação</dt>
            <dd>
              {conversation ? dt(conversation.created_at) : 'Não registrada'}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Criado em</dt>
            <dd>{dt(contact.created_at)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Última atualização</dt>
            <dd>{dt(contact.updated_at)}</dd>
          </div>
        </dl>
      </section>
      <section className="space-y-2">
        <h4 className={heading}>Conversa</h4>
        <p className="text-xs">
          {conversation
            ? { open: '● Aberta', pending: '● Pendente', closed: '● Fechada' }[
                conversation.status
              ]
            : 'Nenhuma conversa'}
        </p>
        <Button
          className="w-full"
          size="sm"
          variant="outline"
          disabled={!conversation || busy || !canSendMessages}
          onClick={() => void startAi()}
        >
          ✦ Iniciar conversa com IA
        </Button>
        <Button
          className="w-full"
          size="sm"
          disabled={!canSendMessages || busy}
          onClick={() => setMeetingOpen(true)}
        >
          Agendar reunião
        </Button>
        {meetings.map((m) => (
          <div key={m.id} className="rounded-lg border p-2 text-xs">
            <p className="font-medium">{m.title}</p>
            <p>
              {dt(m.starts_at)} ·{' '}
              {m.status === 'scheduled'
                ? 'Agendada'
                : m.status === 'completed'
                  ? 'Concluída'
                  : 'Cancelada'}
            </p>
            {m.location && <p className="mt-1 break-words">{m.location}</p>}
            {m.status === 'scheduled' && (
              <div className="mt-2 flex gap-2">
                {[
                  ['completed', 'Concluir'],
                  ['cancelled', 'Cancelar'],
                ].map(([status, label]) => (
                  <button
                    key={status}
                    disabled={!canSendMessages || busy}
                    className="text-primary"
                    onClick={() =>
                      void run(async () => {
                        const r = await createClient()
                          .from('contact_meetings')
                          .update({ status })
                          .eq('id', m.id)
                          .eq('account_id', accountId!);
                        if (r.error) throw r.error;
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
      <details>
        <summary className={`${heading} cursor-pointer`}>Histórico</summary>
        <p className="mt-2 text-xs">
          Lead criado em {dt(selectedDeal?.created_at || contact.created_at)}
        </p>
        <div className="flex h-64 flex-col">
          <ContactSidebarSections
            key={`${contact.id}-${refresh}`}
            contact={contact}
            tab="history"
            onOpenDetails={() => {}}
          />
        </div>
      </details>
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Iniciar conversa com IA</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Revise a mensagem antes de enviar ao contato.
          </p>
          <textarea
            aria-label="Mensagem gerada pela IA"
            className={control}
            rows={7}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            disabled={busy || !draft.trim()}
            onClick={() =>
              void run(async () => {
                const r = await fetch('/api/whatsapp/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    conversation_id: conversation?.id,
                    message_type: 'text',
                    content_text: draft.trim(),
                  }),
                });
                const data = await r.json();
                if (!r.ok) throw Error(data.error);
                setAiOpen(false);
                toast.success('Mensagem enviada.');
              })
            }
          >
            Enviar mensagem
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={meetingOpen} onOpenChange={setMeetingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agendar reunião</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Registre a reunião no CRM. Informe o local ou um link de chamada
            existente.
          </p>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const start = new Date(meetingDate);
                if (
                  !meetingDate ||
                  Number.isNaN(start.getTime()) ||
                  !Number.isFinite(duration) ||
                  duration < 5 ||
                  duration > 480
                )
                  throw Error('Informe data e duração válidas.');
                const r = await createClient()
                  .from('contact_meetings')
                  .insert({
                    account_id: accountId,
                    contact_id: contact.id,
                    user_id: user?.id,
                    title: meetingTitle.trim(),
                    starts_at: start.toISOString(),
                    ends_at: new Date(
                      start.getTime() + duration * 60_000
                    ).toISOString(),
                    location: location.trim() || null,
                  });
                if (r.error) throw r.error;
                setMeetingOpen(false);
                toast.success('Reunião agendada no CRM.');
              });
            }}
          >
            <label className="block text-sm">
              Título
              <input
                required
                maxLength={200}
                className={control}
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Data e horário
              <input
                required
                type="datetime-local"
                className={control}
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Duração (minutos)
              <input
                type="number"
                min={5}
                max={480}
                className={control}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
            <label className="block text-sm">
              Local ou link
              <input
                className={control}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </label>
            <Button disabled={busy || !meetingTitle.trim()}>
              Agendar reunião
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
