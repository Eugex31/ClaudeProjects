import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";

import {
  PanelInspector,
  type PanelInspectorProps,
} from "@/components/app/canvas/panel-inspector";
import type { PanelVM } from "@/components/app/canvas/canvas-stage";

beforeAll(() => {
  const proto = window.Element.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView = vi.fn();
  proto.hasPointerCapture = vi.fn(() => false);
  proto.releasePointerCapture = vi.fn();
  if (!("ResizeObserver" in window)) {
    (window as unknown as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

function makePanel(): PanelVM {
  return {
    id: "p1",
    name: null,
    x: 10,
    y: 20,
    width: 160,
    height: 120,
    zIndex: 0,
    noScroll: false,
    frames: [],
  };
}

function renderInspector(overrides: Partial<PanelInspectorProps> = {}) {
  const props: PanelInspectorProps = {
    panel: makePanel(),
    canManage: true,
    onChange: vi.fn(),
    onCommit: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onZ: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<PanelInspector {...props} />) };
}

describe("PanelInspector", () => {
  it("commits the noScroll switch value in the same tick it changes", () => {
    const { props, getByLabelText } = renderInspector();

    fireEvent.click(getByLabelText("Clip content to the panel"));

    expect(props.onChange).toHaveBeenCalledWith({ noScroll: true });
    expect(props.onCommit).toHaveBeenCalledWith({ noScroll: true });
  });

  it("commits a numeric field with its typed value on blur", () => {
    const panel = makePanel();
    const onChange = vi.fn();
    // The editor feeds the merged value back through `panel`; emulate that by
    // re-rendering with the new width before the blur fires.
    const { rerender, getByLabelText, props } = renderInspector({
      panel,
      onChange,
    });

    const widthInput = getByLabelText("Width");
    fireEvent.change(widthInput, { target: { value: "200" } });
    expect(onChange).toHaveBeenCalledWith({ width: 200 });

    rerender(
      <PanelInspector
        {...props}
        panel={{ ...panel, width: 200 }}
        onChange={onChange}
      />,
    );
    fireEvent.blur(getByLabelText("Width"));
    expect(props.onCommit).toHaveBeenCalledWith({ width: 200 });
  });

  it("disables every mutating control when canManage is false", () => {
    const { getByLabelText, getByRole } = renderInspector({ canManage: false });

    expect((getByLabelText("Width") as HTMLInputElement).disabled).toBe(true);
    expect(
      (getByLabelText("Clip content to the panel") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (getByRole("button", { name: "Delete panel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
