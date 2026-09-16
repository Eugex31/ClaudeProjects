import { describe, it, expect } from "vitest";
import { ForbiddenError, PlanLimitError, toProblem } from "@/lib/errors";

describe("errors", () => {
  it("ForbiddenError maps to a 403 problem with a safe message", () => {
    const p = toProblem(new ForbiddenError("You do not have permission to do that."));
    expect(p.status).toBe(403);
    expect(p.body.detail).toBe("You do not have permission to do that.");
    expect(p.body.title).toBe("Forbidden");
  });
  it("PlanLimitError maps to 402", () => {
    expect(toProblem(new PlanLimitError("Your plan allows 3 screens.")).status).toBe(402);
  });
  it("unknown errors never leak their message", () => {
    const p = toProblem(new Error("stack trace with secrets"));
    expect(p.status).toBe(500);
    expect(p.body.detail).toBe("Something went wrong. Please try again.");
  });
});
