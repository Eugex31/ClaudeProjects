import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders the default (navy) variant with white text utility", () => {
    const { getByRole } = render(<Button>Save</Button>);
    expect(getByRole("button").className).toMatch(/bg-navy/);
    expect(getByRole("button").className).toMatch(/text-white/);
  });
  it("accent variant uses navy text, not white", () => {
    const { getByRole } = render(<Button variant="accent">Highlight</Button>);
    expect(getByRole("button").className).toMatch(/bg-tan/);
    expect(getByRole("button").className).not.toMatch(/text-white/);
  });
});
