"use client";

import { useEffect, useState } from "react";
import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BUILT_IN_MERGE_VARS } from "@/lib/personalization/mergeVars";

export function MergeVarPicker({ onInsert }: { onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  const [customKeys, setCustomKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/contacts/custom-field-keys")
      .then((r) => r.json())
      .then((d) => setCustomKeys(d.keys ?? []))
      .catch(() => setCustomKeys([]));
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Braces className="mr-1.5 size-3.5" />
          Insert merge var
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="max-h-72 overflow-y-auto">
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Contact fields</div>
          {BUILT_IN_MERGE_VARS.map((v) => (
            <button
              key={v.key}
              type="button"
              className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => {
                onInsert(`{{${v.key}}}`);
                setOpen(false);
              }}
            >
              {v.label} <span className="text-muted-foreground">{`{{${v.key}}}`}</span>
            </button>
          ))}
          {customKeys.length > 0 && (
            <>
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Custom fields</div>
              {customKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onInsert(`{{${key}}}`);
                    setOpen(false);
                  }}
                >
                  {key} <span className="text-muted-foreground">{`{{${key}}}`}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
