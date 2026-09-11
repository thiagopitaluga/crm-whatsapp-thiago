"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import type { Contact, Deal, Profile, Task } from "@/types";

interface TaskFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  defaultDeal?: Deal | null;
  onSaved: () => void;
}

function toDateTimeInput(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function TaskForm({
  open,
  onOpenChange,
  task,
  defaultDeal,
  onSaved,
}: TaskFormProps) {
  const t = useTranslations("Tasks.form");
  const supabase = createClient();
  const { accountId, profile } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contactId, setContactId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [contacts, setContacts] = useState<Pick<Contact, "id" | "name" | "phone">[]>([]);
  const [members, setMembers] = useState<Pick<Profile, "id" | "full_name" | "email">[]>([]);
  const [saving, setSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? t("defaultTitle"));
    setDescription(task?.description ?? "");
    setContactId(task?.contact_id ?? defaultDeal?.contact_id ?? "");
    setAssignedTo(task?.assigned_to ?? defaultDeal?.assigned_to ?? profile?.id ?? "");
    setDueAt(toDateTimeInput(task?.due_at));
  }, [defaultDeal, open, profile?.id, t, task]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    void (async () => {
      const [contactsResult, membersResult] = await Promise.all([
        supabase
          .from("contacts")
          .select("id, name, phone")
          .eq("account_id", accountId)
          .order("name"),
        supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("account_id", accountId)
          .order("full_name"),
      ]);
      if (cancelled) return;
      setContacts((contactsResult.data ?? []) as Pick<Contact, "id" | "name" | "phone">[]);
      setMembers((membersResult.data ?? []) as Pick<Profile, "id" | "full_name" | "email">[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, open, supabase]);

  async function handleSave() {
    if (!title.trim() || !contactId || !dueAt || !accountId) {
      toast.error(t("required"));
      return;
    }

    const dueDate = new Date(dueAt);
    if (Number.isNaN(dueDate.getTime())) {
      toast.error(t("invalidDate"));
      return;
    }

    const { data: sessionResult } = await supabase.auth.getSession();
    const userId = sessionResult.session?.user.id;
    if (!userId) {
      toast.error(t("notSignedIn"));
      return;
    }

    setSaving(true);
    const payload = {
      contact_id: contactId,
      deal_id: task?.deal_id ?? defaultDeal?.id ?? null,
      assigned_to: assignedTo || null,
      title: title.trim(),
      description: description.trim() || null,
      due_at: dueDate.toISOString(),
    };

    const { error } = task
      ? await supabase.from("tasks").update(payload).eq("id", task.id)
      : await supabase.from("tasks").insert({
          ...payload,
          account_id: accountId,
          user_id: userId,
          status: "open",
        });
    setSaving(false);

    if (error) {
      toast.error(t("saveFailed"));
      return;
    }

    toast.success(task ? t("updated") : t("created"));
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[calc(100%-1.5rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" />
            {task ? t("editTitle") : t("newTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="task-title">{t("title")}</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("titlePlaceholder")}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-contact">{t("contact")}</Label>
            <select
              id="task-contact"
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="">{t("selectContact")}</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name || contact.phone}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-due-at">{t("dueAt")}</Label>
            <Input
              id="task-due-at"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-assignee">{t("assignee")}</Label>
            <select
              id="task-assignee"
              value={assignedTo}
              onChange={(event) => setAssignedTo(event.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="">{t("unassigned")}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name || member.email}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-description">{t("description")}</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("descriptionPlaceholder")}
              className="min-h-24"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
