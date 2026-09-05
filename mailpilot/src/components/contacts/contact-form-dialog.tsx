"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { contactInputSchema } from "@/lib/validation/contact.schema";
import { TagMultiSelect, type Tag } from "@/components/contacts/tag-multi-select";

const formSchema = contactInputSchema.omit({ customFields: true, tagIds: true });
type FormValues = z.input<typeof formSchema>;

export type ContactRecord = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  company: string | null;
  jobTitle: string | null;
  website: string | null;
  greet: string | null;
  appointmentAt: string | null;
  customFields: unknown;
  tags?: Tag[];
};

// HTML datetime-local inputs need "YYYY-MM-DDTHH:mm" in the viewer's own
// timezone — converting from the ISO string the API returns.
function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ContactFormDialog({
  contact,
  onSaved,
  trigger,
}: {
  contact?: ContactRecord;
  onSaved: () => void;
  trigger?: React.ReactNode;
}) {
  const isEdit = Boolean(contact);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>([]);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: contact?.firstName ?? "",
      lastName: contact?.lastName ?? "",
      email: contact?.email ?? "",
      company: contact?.company ?? "",
      jobTitle: contact?.jobTitle ?? "",
      website: contact?.website ?? "",
      greet: contact?.greet ?? "",
      appointmentAt: toDatetimeLocalValue(contact?.appointmentAt),
    },
  });

  useEffect(() => {
    if (open) {
      // Re-sync form + custom-field state from the current contact each time the dialog opens.
      reset({
        firstName: contact?.firstName ?? "",
        lastName: contact?.lastName ?? "",
        email: contact?.email ?? "",
        company: contact?.company ?? "",
        jobTitle: contact?.jobTitle ?? "",
        website: contact?.website ?? "",
        greet: contact?.greet ?? "",
        appointmentAt: toDatetimeLocalValue(contact?.appointmentAt),
      });
      const existingCustom = (contact?.customFields as Record<string, string> | null) ?? {};
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCustomFields(Object.entries(existingCustom).map(([key, value]) => ({ key, value })));
      setSelectedTags(contact?.tags ?? []);
    }
  }, [open, contact, reset]);

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    const customFieldsRecord = Object.fromEntries(
      customFields.filter((f) => f.key.trim() !== "").map((f) => [f.key.trim(), f.value])
    );
    const payload = { ...values, customFields: customFieldsRecord, tagIds: selectedTags.map((t) => t.id) };

    const res = await fetch(isEdit ? `/api/contacts/${contact!.id}` : "/api/contacts", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to save contact");
      return;
    }

    toast.success(isEdit ? "Contact updated" : "Contact added");
    setOpen(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-2 size-4" />
            Add contact
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>
            Fields left blank will use fallback values when personalizing campaigns.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" {...register("firstName")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" {...register("lastName")} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email *</Label>
            <Input id="email" type="email" {...register("email")} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="company">Company</Label>
              <Input id="company" {...register("company")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jobTitle">Job title</Label>
              <Input id="jobTitle" {...register("jobTitle")} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="website">Website</Label>
            <Input id="website" {...register("website")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="greet">Greet</Label>
            <Input id="greet" placeholder="A short personalized opening line" {...register("greet")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="appointmentAt">Appointment</Label>
            <Input id="appointmentAt" type="datetime-local" {...register("appointmentAt")} />
            <p className="text-xs text-muted-foreground">
              Drives any active &quot;Appointment date&quot; sequence for this contact.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Tags</Label>
            <TagMultiSelect selected={selectedTags} onChange={setSelectedTags} />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Custom fields</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCustomFields((f) => [...f, { key: "", value: "" }])}
              >
                <Plus className="mr-1 size-3.5" />
                Add field
              </Button>
            </div>
            {customFields.map((field, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder="Field name"
                  value={field.key}
                  onChange={(e) =>
                    setCustomFields((f) => f.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)))
                  }
                />
                <Input
                  placeholder="Value"
                  value={field.value}
                  onChange={(e) =>
                    setCustomFields((f) => f.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setCustomFields((f) => f.filter((_, idx) => idx !== i))}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {isEdit ? "Save changes" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
