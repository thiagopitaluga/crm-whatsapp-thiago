"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink, Link2, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { TaskForm } from "@/components/tasks/task-form";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import type { Contact, Deal, PipelineStage, Profile, Tag, Task, TaskStatus } from "@/types";

type TaskFilter = "open" | "completed" | "all";
type CalendarConnection = { connected: boolean; available: boolean; calendar_url: string | null };
type TaskRow = Omit<Task, "contact" | "deal" | "assignee"> & {
  contact?: Pick<Contact, "id" | "name" | "phone"> & { contact_tags?: { tags: Tag | null }[] };
  deal?: (Pick<Deal, "id" | "title" | "stage_id"> & { stage?: Pick<PipelineStage, "id" | "name"> | null }) | null;
  assignee?: Pick<Profile, "id" | "full_name" | "email"> | null;
};

function formatDueAt(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function dateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function defaultTimeForDay(day: Date) { const value = new Date(day); value.setHours(9, 0, 0, 0); return value; }
function monthDays(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const first = new Date(start); first.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 42 }, (_, index) => { const day = new Date(first); day.setDate(first.getDate() + index); return day; });
}
function hydrateTask(row: TaskRow): Task {
  return {
    ...row,
    contact: row.contact ? { id: row.contact.id, name: row.contact.name, phone: row.contact.phone, tags: (row.contact.contact_tags ?? []).map((link) => link.tags).filter((tag): tag is Tag => Boolean(tag)) } : undefined,
    deal: row.deal ? { id: row.deal.id, title: row.deal.title, stage_id: row.deal.stage_id, stage: row.deal.stage ?? null } : null,
    assignee: row.assignee ?? null,
  };
}

export default function TasksPage() {
  const t = useTranslations("Tasks.page");
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { accountId } = useAuth();
  const canScheduleTasks = useCan("send-messages");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [members, setMembers] = useState<Pick<Profile, "id" | "full_name" | "email">[]>([]);
  const [stages, setStages] = useState<Pick<PipelineStage, "id" | "name">[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [search, setSearch] = useState("");
  const [contactFilter, setContactFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [defaultDueAt, setDefaultDueAt] = useState<Date | null>(null);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [calendar, setCalendar] = useState<CalendarConnection | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    if (!accountId) return;
    const { data, error } = await supabase.from("tasks").select("*, contact:contacts(id,name,phone,contact_tags(tags(id,name,color))), deal:deals(id,title,stage_id,stage:pipeline_stages(id,name)), assignee:profiles!tasks_assigned_to_fkey(id,full_name,email)").eq("account_id", accountId).order("due_at", { ascending: true });
    if (error) { toast.error(t("loadFailed")); return; }
    setTasks((data ?? []).map((row) => hydrateTask(row as TaskRow)));
  }, [accountId, supabase, t]);

  const loadOptions = useCallback(async () => {
    if (!accountId) return;
    const [tagsResult, membersResult, pipelinesResult] = await Promise.all([
      supabase.from("tags").select("id,name,color").eq("account_id", accountId).order("name"),
      supabase.from("profiles").select("id,full_name,email").eq("account_id", accountId).order("full_name"),
      supabase.from("pipelines").select("id").eq("account_id", accountId),
    ]);
    setTags((tagsResult.data ?? []) as Tag[]);
    setMembers((membersResult.data ?? []) as Pick<Profile, "id" | "full_name" | "email">[]);
    const pipelineIds = (pipelinesResult.data ?? []).map((pipeline) => pipeline.id);
    if (pipelineIds.length === 0) return;
    const { data } = await supabase.from("pipeline_stages").select("id,name").in("pipeline_id", pipelineIds).order("position");
    setStages((data ?? []) as Pick<PipelineStage, "id" | "name">[]);
  }, [accountId, supabase]);

  const loadCalendarConnection = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const response = await fetch("/api/google-calendar", { cache: "no-store" });
      if (!response.ok) throw new Error("status request failed");
      setCalendar((await response.json()) as CalendarConnection);
    } catch { setCalendar({ connected: false, available: false, calendar_url: null }); }
    finally { setCalendarLoading(false); }
  }, []);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    void Promise.all([loadTasks(), loadOptions()]).finally(() => setLoading(false));
  }, [accountId, loadOptions, loadTasks]);
  useEffect(() => { void loadCalendarConnection(); }, [loadCalendarConnection]);
  useEffect(() => {
    const result = searchParams.get("google_calendar");
    if (result === "connected") toast.success(t("googleConnected"));
    if (result === "not_configured") toast.error(t("googleUnavailable"));
    if (result === "error") toast.error(t("googleConnectionFailed"));
  }, [searchParams, t]);

  const now = Date.now();
  const contacts = useMemo(() => Array.from(new Map(tasks.filter((task) => task.contact).map((task) => [task.contact!.id, task.contact!])).values()), [tasks]);
  const filteredTasks = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return tasks.filter((task) => {
      if (filter !== "all" && task.status !== filter) return false;
      if (contactFilter && task.contact_id !== contactFilter) return false;
      if (tagFilter && !task.contact?.tags?.some((tag) => tag.id === tagFilter)) return false;
      if (stageFilter && task.deal?.stage_id !== stageFilter) return false;
      if (assigneeFilter && task.assigned_to !== assigneeFilter) return false;
      return !normalizedSearch || [task.title, task.description, task.contact?.name, task.contact?.phone, task.deal?.title].filter(Boolean).some((value) => value!.toLocaleLowerCase().includes(normalizedSearch));
    });
  }, [assigneeFilter, contactFilter, filter, search, stageFilter, tagFilter, tasks]);
  const tasksByDay = useMemo(() => {
    const values = new Map<string, Task[]>();
    filteredTasks.forEach((task) => { const key = dateKey(task.due_at); values.set(key, [...(values.get(key) ?? []), task]); });
    return values;
  }, [filteredTasks]);
  const overdueCount = tasks.filter((task) => task.status === "open" && new Date(task.due_at).getTime() < now).length;
  const todayCount = tasks.filter((task) => task.status === "open" && dateKey(task.due_at) === dateKey(new Date())).length;

  function openNewTask(day?: Date) { setEditingTask(null); setDefaultDueAt(day ? defaultTimeForDay(day) : null); setFormOpen(true); }
  function closeForm(open: boolean) { setFormOpen(open); if (!open) { setEditingTask(null); setDefaultDueAt(null); } }
  async function updateStatus(task: Task, status: TaskStatus) {
    const completedAt = status === "completed" ? new Date().toISOString() : null;
    const { error } = await supabase.from("tasks").update({ status, completed_at: completedAt }).eq("id", task.id);
    if (error) { toast.error(t("saveFailed")); return; }
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status, completed_at: completedAt } : item));
    toast.success(status === "completed" ? t("completedSuccess") : t("reopenedSuccess"));
  }
  async function deleteTask(task: Task) {
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) { toast.error(t("saveFailed")); return; }
    setTasks((current) => current.filter((item) => item.id !== task.id)); toast.success(t("deleted"));
  }
  function connectGoogleCalendar() {
    if (!calendar?.available) { toast.error(t("googleUnavailable")); return; }
    window.location.assign("/api/google-calendar/connect");
  }

  const calendarDays = monthDays(month);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-foreground">{t("title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("description")}</p></div><GatedButton canAct={canScheduleTasks} gateReason="schedule tasks" onClick={() => openNewTask()}><Plus className="size-4" />{t("newTask")}</GatedButton></div>

    <div className="grid gap-3 sm:grid-cols-3"><SummaryCard icon={CalendarClock} label={t("open")} value={tasks.filter((task) => task.status === "open").length} /><SummaryCard icon={Clock3} label={t("today")} value={todayCount} /><SummaryCard icon={Clock3} label={t("overdue")} value={overdueCount} danger /></div>

    <div className="flex flex-wrap gap-2 border-b border-border pb-3">{(["open", "completed", "all"] as TaskFilter[]).map((value) => <Button key={value} type="button" size="sm" variant={filter === value ? "default" : "ghost"} onClick={() => setFilter(value)}>{t(value)}</Button>)}</div>
    <div className="grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-5"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchPlaceholder")} className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" /><FilterSelect value={contactFilter} onChange={setContactFilter} label={t("filterLead")} options={contacts.map((contact) => ({ value: contact.id, label: contact.name || contact.phone }))} /><FilterSelect value={tagFilter} onChange={setTagFilter} label={t("filterTag")} options={tags.map((tag) => ({ value: tag.id, label: tag.name }))} /><FilterSelect value={stageFilter} onChange={setStageFilter} label={t("filterStage")} options={stages.map((stage) => ({ value: stage.id, label: stage.name }))} /><FilterSelect value={assigneeFilter} onChange={setAssigneeFilter} label={t("filterAssignee")} options={members.map((member) => ({ value: member.id, label: member.full_name || member.email }))} /></div>

    <section className="rounded-xl border border-border bg-card p-3 sm:p-4"><div className="mb-3 flex items-center justify-between gap-2"><Button type="button" size="icon" variant="ghost" aria-label={t("previousMonth")} onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft className="size-4" /></Button><div className="text-center"><p className="font-semibold text-foreground">{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month)}</p><button type="button" className="text-xs text-primary hover:underline" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>{t("goToToday")}</button></div><Button type="button" size="icon" variant="ghost" aria-label={t("nextMonth")} onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight className="size-4" /></Button></div><div className="grid grid-cols-7 border-l border-t border-border">{Array.from({ length: 7 }, (_, index) => <div key={index} className="border-b border-r border-border px-1 py-2 text-center text-xs font-medium text-muted-foreground">{new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(new Date(2023, 0, index + 1))}</div>)}{calendarDays.map((day) => { const key = dateKey(day); const dayTasks = tasksByDay.get(key) ?? []; const currentMonth = day.getMonth() === month.getMonth(); const isToday = key === dateKey(new Date()); return <button key={key} type="button" disabled={!canScheduleTasks || !currentMonth} onClick={() => openNewTask(day)} className={`min-h-20 border-b border-r border-border p-1.5 text-left transition-colors hover:bg-muted disabled:cursor-default ${currentMonth ? "bg-card" : "bg-muted/30 text-muted-foreground"}`}><span className={`inline-flex size-6 items-center justify-center rounded-full text-xs ${isToday ? "bg-primary font-semibold text-primary-foreground" : ""}`}>{day.getDate()}</span><div className="mt-1 space-y-1">{dayTasks.slice(0, 2).map((task) => <div key={task.id} className={`truncate rounded px-1 py-0.5 text-[11px] ${task.status === "completed" ? "bg-emerald-500/10 text-emerald-600 line-through dark:text-emerald-400" : "bg-primary/10 text-primary"}`}>{task.title}</div>)}{dayTasks.length > 2 ? <p className="px-1 text-[11px] text-muted-foreground">{t("moreTasks", { count: dayTasks.length - 2 })}</p> : null}</div></button>; })}</div><p className="mt-3 text-xs text-muted-foreground">{t("calendarHint")}</p></section>

    {loading ? <div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div> : filteredTasks.length === 0 ? <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center"><CalendarClock className="size-10 text-muted-foreground" /><h3 className="mt-4 font-medium text-foreground">{t("emptyTitle")}</h3><p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("emptyDescription")}</p></div> : <div className="space-y-3">{filteredTasks.map((task) => { const overdue = task.status === "open" && new Date(task.due_at).getTime() < now; const isCompleted = task.status === "completed"; return <article key={task.id} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center"><Button type="button" size="sm" variant={isCompleted ? "outline" : "default"} className={`self-start ${isCompleted ? "" : "bg-emerald-600 hover:bg-emerald-700"}`} onClick={() => void updateStatus(task, isCompleted ? "open" : "completed")} disabled={!canScheduleTasks}><CheckCircle2 className="size-4" />{isCompleted ? t("reopen") : t("complete")}</Button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h3 className={`font-semibold ${isCompleted ? "text-muted-foreground line-through" : "text-foreground"}`}>{task.title}</h3><span className={`text-sm ${overdue ? "font-medium text-red-500" : "text-muted-foreground"}`}>{formatDueAt(task.due_at)}</span>{isCompleted ? <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{t("completed")}</span> : null}</div><p className="mt-1 text-sm text-muted-foreground">{task.contact?.name || task.contact?.phone || t("unknownContact")}{task.deal?.title ? ` · ${task.deal.title}` : ""}{task.deal?.stage?.name ? ` · ${task.deal.stage.name}` : ""}</p>{task.contact?.tags?.length ? <div className="mt-2 flex flex-wrap gap-1">{task.contact.tags.map((tag) => <span key={tag.id} className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: `${tag.color}22`, color: tag.color }}>{tag.name}</span>)}</div> : null}{task.description ? <p className="mt-2 text-sm text-muted-foreground">{task.description}</p> : null}</div><div className="flex shrink-0 flex-wrap items-center gap-1">{task.assignee ? <span className="mr-2 inline-flex items-center gap-1 text-xs text-muted-foreground"><UserRound className="size-3.5" />{task.assignee.full_name || task.assignee.email}</span> : null}<Button type="button" variant="ghost" size="icon" title={t("edit")} onClick={() => { setEditingTask(task); setDefaultDueAt(null); setFormOpen(true); }} disabled={!canScheduleTasks}><Pencil className="size-4" /></Button><Button type="button" variant="ghost" size="icon" title={t("delete")} onClick={() => void deleteTask(task)} disabled={!canScheduleTasks} className="text-red-500 hover:text-red-600"><Trash2 className="size-4" /></Button></div></article>; })}</div>}
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"><Link2 className="size-4 text-muted-foreground" /><p className="mr-auto text-sm font-medium text-foreground">{t("googleCalendarTitle")}</p>{calendar?.connected ? <><span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">{t("googleConnectedStatus")}</span><Button type="button" size="sm" variant="outline" onClick={() => window.open(calendar.calendar_url ?? "https://calendar.google.com/", "_blank", "noopener,noreferrer")}><ExternalLink className="size-3.5" />{t("openGoogleCalendar")}</Button></> : <><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{t("googleDisconnected")}</span><Button type="button" size="sm" variant="outline" onClick={connectGoogleCalendar} disabled={calendarLoading}><Link2 className="size-3.5" />{t("connectGoogleCalendar")}</Button></>}</div>
    <TaskForm open={formOpen} onOpenChange={closeForm} task={editingTask} defaultDueAt={defaultDueAt} onSaved={() => void loadTasks()} />
  </div>;
}

function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: { value: string; label: string }[] }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-0 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"><option value="">{label}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}
function SummaryCard({ icon: Icon, label, value, danger = false }: { icon: typeof CalendarClock; label: string; value: number; danger?: boolean }) {
  return <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className={danger ? "size-4 text-red-500" : "size-4 text-primary"} />{label}</div><p className={`mt-2 text-2xl font-semibold ${danger && value > 0 ? "text-red-500" : "text-foreground"}`}>{value}</p></div>;
}
