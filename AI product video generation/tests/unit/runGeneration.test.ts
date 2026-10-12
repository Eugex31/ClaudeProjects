import { describe, expect, test, vi } from "vitest";
import { runGeneration, type GenerationContext } from "@/lib/ai/runGeneration";
import { GenerationError } from "@/lib/ai/generate";

const ctx: GenerationContext = {
  role: "editor", quota: 20, used: 0, language: "en", aiConfigured: true, manualText: "Attach sides.",
  parts: [{ id: "a", label: "a", size: [1, 1, 1], center: [0, 0, 0] }],
};
const deps = (generate = vi.fn().mockResolvedValue([{ title: "T", narration: "N", parts: ["a", "ghost"], from: "left", camera: "iso", warning: "" }])) => ({
  generate, saveSteps: vi.fn().mockResolvedValue(undefined), incrementUsage: vi.fn().mockResolvedValue(undefined),
});

describe("runGeneration", () => {
  test("404 when project not visible", async () => expect((await runGeneration(null, deps())).status).toBe(404));
  test("403 for viewers", async () => expect((await runGeneration({ ...ctx, role: "viewer" }, deps())).status).toBe(403));
  test("503 when AI not configured", async () => expect((await runGeneration({ ...ctx, aiConfigured: false }, deps())).status).toBe(503));
  test("429 at quota, no AI call", async () => {
    const d = deps();
    expect((await runGeneration({ ...ctx, used: 20 }, d)).status).toBe(429);
    expect(d.generate).not.toHaveBeenCalled();
  });
  test("400 without manual text", async () => expect((await runGeneration({ ...ctx, manualText: " " }, deps())).status).toBe(400));

  test("AI refusal: 422, usage not incremented, nothing saved", async () => {
    const d = deps(vi.fn().mockRejectedValue(new GenerationError("declined", 422)));
    const r = await runGeneration(ctx, d);
    expect(r.status).toBe(422);
    expect(d.incrementUsage).not.toHaveBeenCalled();
    expect(d.saveSteps).not.toHaveBeenCalled();
  });
  test("unexpected AI error: 502, usage not incremented", async () => {
    const d = deps(vi.fn().mockRejectedValue(new Error("network")));
    expect((await runGeneration(ctx, d)).status).toBe(502);
    expect(d.incrementUsage).not.toHaveBeenCalled();
  });
  test("success validates, saves and increments once", async () => {
    const d = deps();
    const r = await runGeneration(ctx, d);
    expect(r.status).toBe(200);
    if (!("steps" in r)) return;
    expect(r.steps[0].parts).toEqual(["a"]);
    expect(r.issues.some((i) => i.message.includes("ghost"))).toBe(true);
    expect(d.saveSteps).toHaveBeenCalledWith(r.steps);
    expect(d.incrementUsage).toHaveBeenCalledTimes(1);
  });
  test("save failure: 500, usage not incremented", async () => {
    const d = deps();
    d.saveSteps.mockRejectedValue(new Error("db"));
    expect((await runGeneration(ctx, d)).status).toBe(500);
    expect(d.incrementUsage).not.toHaveBeenCalled();
  });
  test("AI returns no steps: 502, nothing saved or charged", async () => {
    const d = deps(vi.fn().mockResolvedValue([]));
    expect((await runGeneration(ctx, d)).status).toBe(502);
    expect(d.saveSteps).not.toHaveBeenCalled();
    expect(d.incrementUsage).not.toHaveBeenCalled();
  });
});
