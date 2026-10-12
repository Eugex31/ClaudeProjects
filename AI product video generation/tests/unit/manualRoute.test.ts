import { beforeEach, expect, test, vi } from "vitest";
import { MAX_PDF_BYTES } from "@/lib/manual";

const state = { blob: new Blob([]), updated: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain, eq: () => chain,
        single: async () => ({ data: { storage_path: "o/p/a-m.pdf" }, error: null }),
        update: () => { state.updated(table); return chain; },
      };
      return chain;
    },
    storage: { from: () => ({ download: async () => ({ data: state.blob, error: null }) }) },
  }),
}));

const { POST } = await import("@/app/api/projects/[id]/manual/route");
const call = () => POST(new Request("http://x", { method: "POST", body: JSON.stringify({ assetId: "a" }) }), { params: Promise.resolve({ id: "p" }) });

beforeEach(() => state.updated.mockReset());

test("PDFs over 20 MB are rejected with 413 before parsing", async () => {
  state.blob = new Blob([new Uint8Array(MAX_PDF_BYTES + 1)]);
  const res = await call();
  expect(res.status).toBe(413);
  expect((await res.json()).error).toMatch(/20 MB/);
  expect(state.updated).not.toHaveBeenCalled();
});

test("a small file goes on to parsing (unreadable bytes give 422, not 413)", async () => {
  state.blob = new Blob([new Uint8Array(16)]);
  expect((await call()).status).toBe(422);
});
