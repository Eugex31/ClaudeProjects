import { expect, test } from "vitest";
import { pickMimeType, wrapText } from "@/lib/player/record";

test("prefers mp4, then vp9 webm, then webm", () => {
  expect(pickMimeType(() => true)).toBe("video/mp4;codecs=avc1");
  expect(pickMimeType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9");
  expect(pickMimeType((t) => t === "video/webm")).toBe("video/webm");
  expect(pickMimeType(() => false)).toBeNull();
});

test("wraps words to max width", () => {
  const measure = (s: string) => s.length * 10;
  expect(wrapText(measure, "one two three four", 90)).toEqual(["one two", "three", "four"]);
  expect(wrapText(measure, "", 90)).toEqual([]);
});
