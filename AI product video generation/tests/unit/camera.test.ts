import { expect, test } from "vitest";
import { cameraPosition } from "@/lib/player/camera";

const bounds = { center: [0, 1, 0] as [number, number, number], radius: 1 };

test("front looks from +z at 2.5 radii", () => {
  expect(cameraPosition("front", bounds)).toEqual([0, 1, 2.5]);
});
test("top looks from above with a tiny z offset to avoid gimbal lock", () => {
  const [x, y, z] = cameraPosition("top", bounds);
  expect(x).toBe(0);
  expect(y).toBeCloseTo(3.5);
  expect(z).toBeGreaterThan(0);
});
test("iso is equidistant", () => {
  const [x, y, z] = cameraPosition("iso", bounds);
  expect(Math.hypot(x, y - 1, z)).toBeCloseTo(2.5);
});
