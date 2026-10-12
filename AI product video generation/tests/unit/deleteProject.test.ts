import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteProjectAndFiles } from "@/lib/data/deleteProject";

function fakeClient(opts: { assets: { storage_path: string }[]; deleted: { id: string }[] | null; deleteError?: { message: string }; rmError?: { message: string } }) {
  const remove = vi.fn().mockResolvedValue({ error: opts.rmError ?? null });
  const del = vi.fn();
  const client = {
    from: (table: string) => ({
      select: () => ({ eq: async () => ({ data: table === "assets" ? opts.assets : null, error: null }) }),
      delete: () => ({ eq: () => ({ select: async () => { del(); return { data: opts.deleted, error: opts.deleteError ?? null }; } }) }),
    }),
    storage: { from: () => ({ remove }) },
  } as unknown as SupabaseClient;
  return { client, remove, del };
}

test("deletes the project, then removes only non-sample files", async () => {
  const f = fakeClient({ assets: [{ storage_path: "sample:bookshelf.glb" }, { storage_path: "o/p/a-m.glb" }], deleted: [{ id: "p" }] });
  expect(await deleteProjectAndFiles(f.client, "p")).toEqual({ ok: true, filesRemoved: true });
  expect(f.remove).toHaveBeenCalledWith(["o/p/a-m.glb"]);
});

test("no rows deleted means no permission and no storage removal", async () => {
  const f = fakeClient({ assets: [{ storage_path: "o/p/a-m.glb" }], deleted: [] });
  expect(await deleteProjectAndFiles(f.client, "p")).toEqual({ ok: false, error: "You don't have permission to delete this project." });
  expect(f.remove).not.toHaveBeenCalled();
});

test("database error is reported", async () => {
  const f = fakeClient({ assets: [], deleted: null, deleteError: { message: "boom" } });
  expect(await deleteProjectAndFiles(f.client, "p")).toEqual({ ok: false, error: "boom" });
});

test("storage failure after delete is reported as partial", async () => {
  const f = fakeClient({ assets: [{ storage_path: "o/p/a-m.glb" }], deleted: [{ id: "p" }], rmError: { message: "x" } });
  expect(await deleteProjectAndFiles(f.client, "p")).toEqual({ ok: true, filesRemoved: false });
});

test("only samples: storage untouched", async () => {
  const f = fakeClient({ assets: [{ storage_path: "sample:bookshelf.glb" }], deleted: [{ id: "p" }] });
  expect(await deleteProjectAndFiles(f.client, "p")).toEqual({ ok: true, filesRemoved: true });
  expect(f.remove).not.toHaveBeenCalled();
});
