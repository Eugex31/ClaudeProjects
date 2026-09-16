import { afterEach } from "vitest";

// React Testing Library appends rendered trees to document.body and does not
// tear them down between tests unless we ask it to. Only wire this up when a
// DOM is present (the *.test.tsx files run under jsdom); node-environment
// suites skip it entirely.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => {
    cleanup();
  });
}
