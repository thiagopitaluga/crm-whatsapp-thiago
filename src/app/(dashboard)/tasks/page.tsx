"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Pencil,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { TaskForm } from "@/components/tasks/task-form";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import type { Task, TaskStatus } from "@/types";

type TaskFilter = "open" | "completed" | "all";

function formatDueAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function TasksPage() {
  const t = useTranslations("Tasks.page");
  const supabase = createClient();
  const { accountId } = useAuth();
  const canScheduleTasks = useCan("send-messages");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const loadTasks = useCallback(async () => {
    if (!accountId) return;
    const { data, error } = await supabase
      .from("tasks")
      .select("*, contact:contacts(id,name,phone), deal:deals(id,title), assignee:profiles!tasks_assigned_to_fkey(id,full_name,email)")
      .eq("account_id", accountId)
      .order("due_at", { ascending: true });
    if (error) {
      toast.error(t("loadFailed"));
      return;
    }
    setTasks((data ?? []) as Task[]);
  }, [accountId, supabase, t]);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    void loadTasks().finally(() => setLoading(false));
  }, [accountId, loadTasks]);

  const now = Date.now();
  const overdueCount = tasks.filter(
    (task) => task.status === "open" && new Date(task.due_at).getTime() < now,
  ).length;
  const todayCount = tasks.filter((task) => {
    const date = new Date(task.due_at);
    const today = new Date();
    return task.status === "open" && date.toDateString() === today.toDateString();
  }).length;
  const visibleTasks = useMemo(
    () => tasks.filter((task) => filter === "all" || task.status === filter),
    [filter, tasks],
  );

  async function updateStatus(task: Task, status: TaskStatus) {
    const { error } = await supabase
      .from("tasks")
      .update({
        status,
        completed_at: status === "completed" ? new Date().toISOString() : null,
      })
      .eq("id", task.id);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? { ...item, status, completed_at: status === "completed" ? new Date().toISOString() : null }
          : item,
      ),
    );
  }

  async function deleteTask(task: Task) {
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    setTasks((current) => current.filter((item) => item.id !== task.id));
    toast.success(t("deleted"));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <GatedButton
          canAct={canScheduleTasks}
          gateReason="schedule tasks"
          onClick={() => {
            setEditingTask(null);
            setFormOpen(true);
          }}
        >
          <Plus className="size-4" />
          {t("newTask")}
        </GatedButton>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <CalendarClock className="size-5 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{t("googleCalendarTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("googleCalendarDescription")}</p>
        </div>
        <span className="rounded-full border border-primary/20 bg-background px-2.5 py-1 text-xs font-medium text-primary">{t("googleCalendarSoon")}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={CalendarClock} label={t("open")} value={tasks.filter((task) => task.status === "open").length} />
        <SummaryCard icon={Clock3} label={t("today")} value={todayCount} />
        <SummaryCard icon={Clock3} label={t("overdue")} value={overdueCount} danger />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {(["open", "completed", "all"] as TaskFilter[]).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={filter === value ? "default" : "ghost"}
            onClick={() => setFilter(value)}
          >
            {t(value)}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <CalendarClock className="size-10 text-muted-foreground" />
          <h3 className="mt-4 font-medium text-foreground">{t("emptyTitle")}</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("emptyDescription")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleTasks.map((task) => {
            const overdue = task.status === "open" && new Date(task.due_at).getTime() < now;
            return (
              <article key={task.id} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center">
                <button
                  type="button"
                  aria-label={task.status === "completed" ? t("reopen") : t("complete")}
                  title={task.status === "completed" ? t("reopen") : t("complete")}
                  onClick={() => void updateStatus(task, task.status === "completed" ? "open" : "completed")}
                  disabled={!canScheduleTasks}
                  className={`shrink-0 rounded-full p-1 transition-colors ${task.status === "completed" ? "text-emerald-500" : "text-muted-foreground hover:bg-muted hover:text-primary"}`}
                >
                  {task.status === "completed" ? <CheckCircle2 className="size-6" /> : <CalendarClock className="size-6" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className={`font-semibold ${task.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"}`}>{task.title}</h3>
                    <span className={`text-sm ${overdue ? "font-medium text-red-500" : "text-muted-foreground"}`}>{formatDueAt(task.due_at)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {task.contact?.name || task.contact?.phone || t("unknownContact")}
                    {task.deal?.title ? ` · ${task.deal.title}` : ""}
                  </p>
                  {task.description ? <p className="mt-2 text-sm text-muted-foreground">{task.description}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {task.assignee ? <span className="mr-2 inline-flex items-center gap-1 text-xs text-muted-foreground"><UserRound className="size-3.5" />{task.assignee.full_name || task.assignee.email}</span> : null}
                  <Button type="button" variant="ghost" size="icon" title={t("edit")} onClick={() => { setEditingTask(task); setFormOpen(true); }} disabled={!canScheduleTasks}><Pencil className="size-4" /></Button>
                  <Button type="button" variant="ghost" size="icon" title={t("delete")} onClick={() => void deleteTask(task)} disabled={!canScheduleTasks} className="text-red-500 hover:text-red-600"><Trash2 className="size-4" /></Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <TaskForm open={formOpen} onOpenChange={setFormOpen} task={editingTask} onSaved={() => void loadTasks()} />
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  danger = false,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className={danger ? "size-4 text-red-500" : "size-4 text-primary"} />{label}</div>
      <p className={`mt-2 text-2xl font-semibold ${danger && value > 0 ? "text-red-500" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
