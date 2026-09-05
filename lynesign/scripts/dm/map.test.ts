import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mapDump, mapFrameType, mapUserRole } from "./map";

const dump = JSON.parse(readFileSync("scripts/fixtures/displaymonkey.sample.json", "utf8"));

describe("Display Monkey mapping", () => {
  it("maps integer frame types to the FrameType enum", () => {
    expect(mapFrameType(0)).toBe("CLOCK");
    expect(mapFrameType(1)).toBe("PICTURE");
  });
  it("maps admin to ADMIN and anything else to VIEWER", () => {
    expect(mapUserRole("admin")).toBe("ADMIN");
    expect(mapUserRole("whatever")).toBe("VIEWER");
  });
  it("builds a Location tree with Level as the parent", () => {
    const mapped = mapDump(dump, { organizationId: "org_1" });
    const parents = mapped.locations.filter((l) => l.parentId === null);
    const children = mapped.locations.filter((l) => l.parentId !== null);
    expect(parents.length).toBe(1);
    expect(children.length).toBe(2);
    expect(mapped.locations.every((l) => l.organizationId === "org_1")).toBe(true);
  });
  it("drops Display.Host and marks screens UNPAIRED", () => {
    const mapped = mapDump(dump, { organizationId: "org_1" });
    expect(mapped.screens.every((s) => s.status === "UNPAIRED")).toBe(true);
    expect(mapped.screens.every((s) => !("host" in s))).toBe(true);
  });
});
