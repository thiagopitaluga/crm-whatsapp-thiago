'use client';

import { useEffect, useState } from 'react';
import { FileDown, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TaskForm } from '@/components/tasks/task-form';
import type { ContactDetailTab } from '@/components/contacts/contact-detail-view';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { downloadMediaMessage } from '@/lib/media/download';
import type { Contact, Message, Task } from '@/types';

export type SidebarTab =
  'overview' | 'data' | 'files' | 'history' | 'tasks' | 'campaigns';
type Event = {
  id: string;
  deal_title: string;
  from_stage_name: string | null;
  to_stage_name: string;
  occurred_at: string;
};
type Campaign = {
  id: string;
  status: string;
  sent_at: string | null;
  created_at: string;
  broadcasts: { name: string } | null;
};

export function ContactSidebarSections({
  contact,
  tab,
  onOpenDetails,
}: {
  contact: Contact;
  tab: Exclude<SidebarTab, 'overview'>;
  onOpenDetails: (tab: ContactDetailTab) => void;
}) {
  const { accountId } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [files, setFiles] = useState<Message[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!accountId || tab === 'data') return;
    let cancelled = false;
    const db = createClient();
    async function load() {
      setLoading(true);
      setError(false);
      try {
        if (tab === 'tasks') {
          const result = await db
            .from('tasks')
            .select('*')
            .eq('account_id', accountId!)
            .eq('contact_id', contact.id)
            .order('due_at');
          if (result.error) throw result.error;
          if (!cancelled) setTasks((result.data ?? []) as Task[]);
        } else if (tab === 'files') {
          const conversations = await db
            .from('conversations')
            .select('id')
            .eq('account_id', accountId!)
            .eq('contact_id', contact.id);
          if (conversations.error) throw conversations.error;
          const ids = (conversations.data ?? []).map((row) => row.id);
          if (ids.length) {
            const result = await db
              .from('messages')
              .select('*')
              .in('conversation_id', ids)
              .not('media_url', 'is', null)
              .order('created_at', { ascending: false })
              .limit(100);
            if (result.error) throw result.error;
            if (!cancelled) setFiles((result.data ?? []) as Message[]);
          }
        } else if (tab === 'history') {
          const deals = await db
            .from('deals')
            .select('id')
            .eq('account_id', accountId!)
            .eq('contact_id', contact.id);
          if (deals.error) throw deals.error;
          const ids = (deals.data ?? []).map((row) => row.id);
          if (ids.length) {
            const result = await db
              .from('deal_stage_events')
              .select('id,deal_title,from_stage_name,to_stage_name,occurred_at')
              .eq('account_id', accountId!)
              .in('deal_id', ids)
              .order('occurred_at', { ascending: false })
              .limit(100);
            if (result.error) throw result.error;
            if (!cancelled) setEvents((result.data ?? []) as Event[]);
          }
        } else if (tab === 'campaigns') {
          const result = await db
            .from('broadcast_recipients')
            .select('id,status,sent_at,created_at,broadcasts(name)')
            .eq('contact_id', contact.id)
            .order('created_at', { ascending: false })
            .limit(100);
          if (result.error) throw result.error;
          if (!cancelled)
            setCampaigns((result.data ?? []) as unknown as Campaign[]);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId, contact.id, tab, refresh]);

  const date = (value: string) =>
    new Date(value).toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  const empty = (message: string) => (
    <p className="text-muted-foreground text-xs">{message}</p>
  );
  return (
    <>
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4 text-sm">
          {tab === 'data' && (
            <>
              <h3 className="font-semibold">Dados do contato</h3>
              {[
                ['Nome', contact.name],
                ['Telefone', contact.phone],
                ['E-mail', contact.email],
                ['Empresa', contact.company],
              ].map(([label, value]) => (
                <div key={label} className="border-border border-b pb-2">
                  <span className="text-muted-foreground block text-xs">
                    {label}
                  </span>
                  <span className="break-all">{value || 'Não informado'}</span>
                </div>
              ))}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => onOpenDetails('details')}
              >
                Editar dados
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => onOpenDetails('custom')}
              >
                Campos personalizados
              </Button>
            </>
          )}
          {tab === 'files' && (
            <>
              <h3 className="font-semibold">Arquivos da conversa</h3>
              <p className="text-muted-foreground text-xs">
                Mídias enviadas ou recebidas neste contato.
              </p>
              {!loading &&
                !error &&
                !files.length &&
                empty('Nenhum arquivo encontrado.')}
              {files.map((file) => (
                <div key={file.id} className="bg-muted rounded-lg p-2">
                  <p className="text-xs">
                    {file.content_text ||
                      (
                        {
                          image: 'Imagem',
                          video: 'Vídeo',
                          audio: 'Áudio',
                          document: 'Documento',
                        } as Record<string, string>
                      )[file.content_type] ||
                      'Arquivo'}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {date(file.created_at)}
                  </p>
                  <button
                    className="text-primary mt-2 flex items-center gap-1 text-xs"
                    onClick={() =>
                      void downloadMediaMessage(file).catch(() =>
                        toast.error('Não foi possível baixar o arquivo.')
                      )
                    }
                  >
                    <FileDown className="size-3" /> Baixar
                  </button>
                </div>
              ))}
            </>
          )}
          {tab === 'history' && (
            <>
              <h3 className="font-semibold">Histórico do funil</h3>
              {!loading &&
                !error &&
                !events.length &&
                empty(
                  'Nenhuma movimentação registrada. Registros anteriores à ativação do histórico podem não aparecer.'
                )}
              {events.map((event) => (
                <div key={event.id} className="bg-muted rounded-lg p-2 text-xs">
                  <p>{event.deal_title}</p>
                  <p className="mt-1">
                    {event.from_stage_name
                      ? `${event.from_stage_name} → `
                      : 'Criado em '}
                    {event.to_stage_name}
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {date(event.occurred_at)}
                  </p>
                </div>
              ))}
            </>
          )}
          {tab === 'tasks' && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Tarefas</h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingTask(null);
                    setTaskOpen(true);
                  }}
                >
                  <Plus className="size-3" /> Nova
                </Button>
              </div>
              {!loading &&
                !error &&
                !tasks.length &&
                empty('Nenhuma tarefa para este contato.')}
              {tasks.map((task) => (
                <div key={task.id} className="bg-muted rounded-lg p-2 text-xs">
                  <p className="font-medium">{task.title}</p>
                  <p className="text-muted-foreground mt-1">
                    {date(task.due_at)} ·{' '}
                    {task.status === 'completed'
                      ? 'Concluída'
                      : task.status === 'cancelled'
                        ? 'Cancelada'
                        : 'Aberta'}
                  </p>
                  <button
                    className="text-primary mt-2"
                    onClick={() => {
                      setEditingTask(task);
                      setTaskOpen(true);
                    }}
                  >
                    Editar
                  </button>
                </div>
              ))}
            </>
          )}
          {tab === 'campaigns' && (
            <>
              <h3 className="font-semibold">Campanhas enviadas</h3>
              {!loading &&
                !error &&
                !campaigns.length &&
                empty('Nenhuma campanha registrada para este contato.')}
              {campaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="bg-muted rounded-lg p-2 text-xs"
                >
                  <p className="font-medium">
                    {campaign.broadcasts?.name || 'Campanha'}
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {campaign.status} ·{' '}
                    {date(campaign.sent_at || campaign.created_at)}
                  </p>
                </div>
              ))}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => onOpenDetails('attribution')}
              >
                Ver origem e anúncios
              </Button>
            </>
          )}
          {loading && empty('Carregando…')}
          {error && (
            <div role="alert" className="text-destructive text-xs">
              Não foi possível carregar os dados.{' '}
              <button
                className="underline"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Tentar novamente
              </button>
            </div>
          )}
        </div>
      </ScrollArea>
      {tab === 'tasks' && (
        <TaskForm
          open={taskOpen}
          onOpenChange={setTaskOpen}
          task={editingTask}
          defaultContactId={contact.id}
          onSaved={() => setRefresh((value) => value + 1)}
        />
      )}
    </>
  );
}
