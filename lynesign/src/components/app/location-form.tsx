"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { createLocation } from "@/app/(app)/locations/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface LocationFormParent {
  id: string;
  name: string;
}

export interface LocationFormProps {
  parents: LocationFormParent[];
  triggerLabel?: string;
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
}

/**
 * "Add location" trigger plus the dialog that hosts the create form. Submits to
 * the {@link createLocation} server action; a returned `{ error }` is shown
 * inline and as a toast, and a success closes the dialog and lets the page
 * revalidate.
 */
export function LocationForm({
  parents,
  triggerLabel = "Add location",
  triggerVariant = "default",
}: LocationFormProps) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createLocation(formData);
      if (result?.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Location created.");
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          <Plus aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add location</DialogTitle>
          <DialogDescription>
            Group your screens by site. Only a name is required.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="location-name">Name</Label>
            <Input id="location-name" name="name" required autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="location-parent">Parent location</Label>
            <select
              id="location-parent"
              name="parentId"
              defaultValue=""
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">None</option>
              {parents.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="location-timezone">Time zone</Label>
              <Input id="location-timezone" name="timeZone" defaultValue="UTC" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-locale">Locale</Label>
              <Input id="location-locale" name="locale" defaultValue="en-US" />
            </div>
          </div>

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Create location"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
