import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Heading } from "@/components/app/heading";

describe("Heading", () => {
  it("splits lead and accent into one heading with a tan accent span", () => {
    const { getByRole } = render(<Heading lead="Your" accent="Screens" />);
    expect(getByRole("heading").textContent).toBe("Your Screens");
    expect(
      getByRole("heading").querySelector(".text-tan")?.textContent
    ).toBe("Screens");
  });

  it("produces exactly one heading with a single accessible name", () => {
    const { getAllByRole } = render(<Heading lead="Your" accent="Screens" />);
    const headings = getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0].getAttribute("aria-label")).toBeNull();
  });

  it("renders lead only when no accent is given", () => {
    const { getByRole } = render(<Heading lead="Dashboard" />);
    expect(getByRole("heading").textContent).toBe("Dashboard");
    expect(getByRole("heading").querySelector(".text-tan")).toBeNull();
  });

  it("honours the as prop", () => {
    const { getByRole } = render(<Heading lead="Big" as="h1" />);
    expect(getByRole("heading", { level: 1 })).toBeTruthy();
  });
});
