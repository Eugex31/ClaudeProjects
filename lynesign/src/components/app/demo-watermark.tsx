import * as React from "react";

/** A single tile of rotated "Demo" text, repeated across the overlay. Encoded as
 * an inline SVG data URI so the watermark needs no network request and no extra
 * DOM per repeat. The fill is a fixed muted slate; the parent element carries
 * the low opacity. */
const TILE_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='150'>" +
      "<text x='4' y='110' transform='rotate(-30 120 75)' " +
      "font-family='system-ui, -apple-system, Segoe UI, sans-serif' " +
      "font-size='46' font-weight='700' fill='#64748b'>Demo</text></svg>",
  );

/**
 * A static, non-interactive "Demo" watermark that fills its positioned parent.
 * It is `aria-hidden`, ignores pointer events and adds no layout, so a preview
 * surface can drop it in as an overlay without changing how the content behind
 * it renders or behaves. The parent must be `position: relative`.
 */
export function DemoWatermark() {
  return (
    <div
      aria-hidden="true"
      data-testid="demo-watermark"
      className="pointer-events-none absolute inset-0 z-50 select-none"
      style={{
        backgroundImage: `url("${TILE_DATA_URI}")`,
        backgroundRepeat: "repeat",
        opacity: 0.12,
      }}
    />
  );
}
