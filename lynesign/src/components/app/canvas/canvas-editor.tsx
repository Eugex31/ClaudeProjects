"use client";

import * as React from "react";
import { Grid2x2, Grid2x2Check, Play, Plus, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createPanel,
  deletePanel,
  duplicatePanel,
  updatePanels,
} from "@/app/(app)/canvas/actions";
import {
  DEFAULT_GRID,
  nextZIndex,
  snap,
  swapZ,
  type Rect,
} from "@/lib/canvas/geometry";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  CanvasStage,
  type FrameKind,
  type PanelVM,
} from "@/components/app/canvas/canvas-stage";
import {
  useCanvasDrag,
  type PanelPatch,
} from "@/components/app/canvas/use-canvas-drag";
import { PanelInspector } from "@/components/app/canvas/panel-inspector";
import { FrameStrip } from "@/components/app/canvas/frame-strip";
import { FrameContentEditor } from "@/components/app/canvas/frame-content-editor";
import { CanvasSettingsDialog } from "@/components/app/canvas/canvas-settings-dialog";
import { CanvasPreviewDialog } from "@/components/app/canvas/canvas-preview-dialog";

/** Media asset row for the Task 13 content pickers, pre-signed on the server. */
export interface CanvasEditorAsset {
  id: string;
  name: string;
  kind: "IMAGE" | "VIDEO" | "WEB";
  thumbnailUrl: string | null;
}

/** The serialized canvas tree the server page hands the editor. No `Date`
 * objects and no functions cross this boundary. */
export interface CanvasTree {
  id: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string | null;
  backgroundImageUrl: string | null;
  revision: number;
  panels: PanelVM[];
}

export interface CanvasEditorProps {
  tree: CanvasTree;
  assets: CanvasEditorAsset[];
  canManage: boolean;
}

/** Grid choices in canvas pixels. `1` is the "no snap" setting. */
const GRID_SIZES = [1, 8, 16, 32] as const;
type GridSize = (typeof GRID_SIZES)[number];

const DEFAULT_GRID_SIZE: GridSize = 8;

/** Widest the stage is allowed to draw. `scale` is derived from this and the
 * canvas width; a ResizeObserver is not used for this task. */
const MAX_STAGE_WIDTH = 900;

const NEW_PANEL_WIDTH = 160;
const NEW_PANEL_HEIGHT = 120;

function panelLabel(panel: PanelVM, index: number): string {
  return panel.name && panel.name.trim().length > 0
    ? panel.name
    : `Panel ${index + 1}`;
}

/**
 * One panel's worth of a save. Wider than the hook's own `PanelPatch`, which
 * only ever carries geometry: the inspector also commits `name`, `zIndex` and
 * `noScroll` through the same boundary. `name` is `string | undefined` rather
 * than the view-model's `string | null`, because that is what `updatePanels`
 * accepts; an unnamed panel sends no `name` at all.
 */
type PanelSavePatch = { id: string; name?: string } & Partial<
  Pick<PanelVM, "x" | "y" | "width" | "height" | "zIndex" | "noScroll">
>;

/** Element tags whose own key handling owns the keystroke. Buttons are
 * deliberately absent: the left-rail panel rows are buttons and selecting one
 * leaves focus on it, so ignoring buttons would kill arrow-nudge on the primary
 * selection path. A button consumes Enter and Space, neither of which is a
 * canvas shortcut. */
const KEY_IGNORE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Overlay roles: a keystroke inside one of these belongs to the overlay. */
const KEY_IGNORE_CONTAINERS = '[role="dialog"], [role="menu"], [role="listbox"]';

/**
 * True when `node` is a control that consumes its own keystrokes, or sits inside
 * an open overlay. The window-level canvas shortcuts bail on it so a panel is
 * never moved or deleted from behind a dialog or out of an unrelated field.
 */
function ignoresCanvasKeys(node: unknown): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (KEY_IGNORE_TAGS.has(node.tagName) || node.isContentEditable) return true;
  return node.closest(KEY_IGNORE_CONTAINERS) !== null;
}

/**
 * Client shell for the visual canvas editor. It owns the panel view-model
 * array, the current selection, and the grid settings, and wires every panel
 * mutation: pointer drag and resize come from `useCanvasDrag`, arrow keys nudge
 * the selection, and "Add panel" / delete call their server actions with an
 * optimistic local update that reverts on `{ error }`. The inspector, frame
 * strip and content editors arrive in Task 13 and a preview button in Task 14;
 * their mount points are marked inline.
 */
export function CanvasEditor({ tree, assets, canManage }: CanvasEditorProps) {
  const [panels, setPanels] = React.useState<PanelVM[]>(tree.panels);
  const [selectedPanelId, setSelectedPanelId] = React.useState<string | null>(
    null,
  );
  const [gridSize, setGridSize] = React.useState<GridSize>(DEFAULT_GRID_SIZE);
  const [showGrid, setShowGrid] = React.useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null,
  );
  const [selectedFrameId, setSelectedFrameId] = React.useState<string | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  // Latest panels for reverts and for reading pre-nudge geometry without
  // threading state through callbacks.
  const panelsRef = React.useRef(panels);
  React.useEffect(() => {
    panelsRef.current = panels;
  });

  // The selected panel's rect and flags at the moment an inspector edit began,
  // so a rejected `updatePanels` can revert the whole panel, not just a rect.
  const inspectorSnapshotRef = React.useRef<PanelVM | null>(null);

  // A route refresh after a frame or content mutation hands down a new `tree`.
  // Adopt its panels so added and edited frames appear, but never mid-write:
  // an in-flight drag or nudge still owns the local array until it settles.
  const [treeSeen, setTreeSeen] = React.useState(tree);
  if (tree !== treeSeen) {
    setTreeSeen(tree);
    if (!pending) setPanels(tree.panels);
  }

  // A new panel selection drops the frame selection. Adjusted during render
  // rather than in an effect so the child strip never sees a frame id from the
  // previous panel. A stale inspector snapshot is handled in `inspectorChange`,
  // which re-snapshots whenever the id does not match the selection.
  const [framePanelSeen, setFramePanelSeen] = React.useState(selectedPanelId);
  if (framePanelSeen !== selectedPanelId) {
    setFramePanelSeen(selectedPanelId);
    if (selectedFrameId !== null) setSelectedFrameId(null);
  }

  const scale = React.useMemo(
    () => Math.min(1, MAX_STAGE_WIDTH / tree.width),
    [tree.width],
  );

  /**
   * The single `updatePanels` boundary. Every panel write in this editor, from a
   * pointer drag, a resize, an arrow nudge, an inspector field or a z-order
   * step, goes through here.
   *
   * It rounds `x`, `y`, `width` and `height` on every patch that carries them.
   * `panelSchema` requires integers, and the geometry pipeline can produce
   * fractions: with the grid set to "Off" `snap` is a passthrough, the pointer
   * delta is divided by `scale`, and an alignment guide on an odd width lands on
   * a half pixel. Without this round every drag and resize on a grid-off canvas
   * would fail server validation and be reverted. `name`, `zIndex` and
   * `noScroll` are passed through untouched.
   *
   * `revert` is the caller's own rollback and runs only on `{ error }`, so each
   * call site keeps its own revert semantics: the pre-drag origin for a drag or
   * nudge, the pre-edit snapshot for the inspector, the whole previous array for
   * a z-order swap.
   */
  const savePanels = React.useCallback(
    (patches: PanelSavePatch[], revert: () => void) => {
      const rounded = patches.map((patch) => {
        const next: PanelSavePatch = { ...patch };
        if (next.x !== undefined) next.x = Math.round(next.x);
        if (next.y !== undefined) next.y = Math.round(next.y);
        if (next.width !== undefined) next.width = Math.round(next.width);
        if (next.height !== undefined) next.height = Math.round(next.height);
        return next;
      });
      startTransition(async () => {
        const result = await updatePanels(tree.id, { panels: rounded });
        if (result && "error" in result) {
          revert();
          toast.error(result.error);
        }
      });
    },
    [tree.id],
  );

  const commitPanel = React.useCallback(
    (id: string, patch: PanelPatch, origin: Rect) => {
      savePanels([{ id, ...patch }], () => {
        // Revert only the panel that failed, back to its pre-change rect.
        setPanels((list) =>
          list.map((p) => (p.id === id ? { ...p, ...origin } : p)),
        );
      });
    },
    [savePanels],
  );

  const { guides, onPanelPointerDown, onResizeHandlePointerDown } = useCanvasDrag(
    {
      canvasSize: { width: tree.width, height: tree.height },
      scale,
      gridSize,
      panels,
      disabled: !canManage,
      onPanelsChange: setPanels,
      onCommit: commitPanel,
    },
  );

  function handlePanelPointerDown(panelId: string, e: React.PointerEvent) {
    setSelectedPanelId(panelId);
    onPanelPointerDown(panelId, e);
  }

  function performDelete(id: string) {
    const snapshot = panelsRef.current;
    setConfirmDeleteId(null);
    setPanels((current) => current.filter((p) => p.id !== id));
    setSelectedPanelId((current) => (current === id ? null : current));
    startTransition(async () => {
      const result = await deletePanel(id);
      if (result && "error" in result) {
        setPanels(snapshot);
        toast.error(result.error);
      }
    });
  }

  function requestDelete(id: string) {
    const panel = panelsRef.current.find((p) => p.id === id);
    if (!panel) return;
    if (panel.frames.length > 0) {
      setConfirmDeleteId(id);
      return;
    }
    performDelete(id);
  }

  function addPanel() {
    const x = snap(20, gridSize);
    const y = snap(20, gridSize);
    const zIndex = nextZIndex(panelsRef.current);
    startTransition(async () => {
      const result = await createPanel({
        canvasId: tree.id,
        x,
        y,
        width: NEW_PANEL_WIDTH,
        height: NEW_PANEL_HEIGHT,
        zIndex,
        noScroll: false,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const created: PanelVM = {
        id: result.id,
        name: null,
        x,
        y,
        width: NEW_PANEL_WIDTH,
        height: NEW_PANEL_HEIGHT,
        zIndex,
        noScroll: false,
        frames: [],
      };
      setPanels((current) => [...current, created]);
      setSelectedPanelId(result.id);
    });
  }

  // Keyboard shortcuts on the selected panel: arrows move 1px, Shift+arrow moves
  // by the grid, Delete / Backspace removes it and Escape drops the selection.
  // Each move commits its own call.
  //
  // These are window-level, so they are gated twice. A keystroke aimed at a
  // control that handles its own keys, or at anything inside an open dialog,
  // menu or listbox, is left alone; and while the preview or settings dialog is
  // open no canvas shortcut fires at all, so a Backspace typed behind the
  // preview cannot delete the panel underneath it.
  React.useEffect(() => {
    if (!canManage) return;
    if (previewOpen || settingsOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (
        ignoresCanvasKeys(e.target) ||
        ignoresCanvasKeys(document.activeElement)
      ) {
        return;
      }

      if (e.key === "Escape") {
        setSelectedPanelId(null);
        setSelectedFrameId(null);
        return;
      }

      const id = selectedPanelId;
      if (!id) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        requestDelete(id);
        return;
      }

      const step = e.shiftKey ? gridSize : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else return;

      e.preventDefault();
      const current = panelsRef.current.find((p) => p.id === id);
      if (!current) return;
      // `panelsRef` is still pre-nudge here, so this is the true origin.
      const origin: Rect = {
        x: current.x,
        y: current.y,
        width: current.width,
        height: current.height,
      };
      const nextX = current.x + dx;
      const nextY = current.y + dy;
      setPanels((panelList) =>
        panelList.map((p) =>
          p.id === id ? { ...p, x: nextX, y: nextY } : p,
        ),
      );
      commitPanel(id, { x: nextX, y: nextY }, origin);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // `requestDelete` reads refs only, so the effect does not depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canManage,
    selectedPanelId,
    gridSize,
    commitPanel,
    previewOpen,
    settingsOpen,
  ]);

  const selectedPanel =
    panels.find((p) => p.id === selectedPanelId) ?? null;
  const confirmPanel =
    panels.find((p) => p.id === confirmDeleteId) ?? null;
  const activeFrame =
    selectedPanel?.frames.find((f) => f.id === selectedFrameId) ?? null;

  // Inspector edits merge straight into the panel array so the stage tracks the
  // field. The first change since the last commit snapshots the panel for a
  // possible revert.
  function inspectorChange(patch: Partial<PanelVM>) {
    const id = selectedPanelId;
    if (!id) return;
    if (
      !inspectorSnapshotRef.current ||
      inspectorSnapshotRef.current.id !== id
    ) {
      inspectorSnapshotRef.current =
        panelsRef.current.find((p) => p.id === id) ?? null;
    }
    setPanels((list) =>
      list.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  }

  // Blur, Enter or a switch flip on an inspector field. `patch` carries the
  // committed value, so a same-tick commit (the `noScroll` switch) does not
  // depend on `panelsRef` having been flushed by its passive effect. The full
  // payload is the pre-edit snapshot with `patch` applied; on `{ error }` every
  // field rolls back to that snapshot.
  function inspectorCommit(patch: Partial<PanelVM>) {
    const id = selectedPanelId;
    if (!id) return;
    const snapshot = inspectorSnapshotRef.current;
    inspectorSnapshotRef.current = null;
    const live = panelsRef.current.find((p) => p.id === id);
    const base = snapshot ?? live;
    if (!base) return;
    const merged: PanelVM = { ...base, ...patch };
    if (
      base.name === merged.name &&
      base.x === merged.x &&
      base.y === merged.y &&
      base.width === merged.width &&
      base.height === merged.height &&
      base.zIndex === merged.zIndex &&
      base.noScroll === merged.noScroll
    ) {
      return;
    }
    // Reflect the committed value locally now, in case `panelsRef` still holds
    // the pre-change panel this tick.
    setPanels((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    savePanels(
      [
        {
          id,
          name: merged.name ?? undefined,
          x: merged.x,
          y: merged.y,
          width: merged.width,
          height: merged.height,
          zIndex: merged.zIndex,
          noScroll: merged.noScroll,
        },
      ],
      () => {
        if (snapshot) {
          setPanels((list) => list.map((p) => (p.id === id ? snapshot : p)));
        }
      },
    );
  }

  // Move the selected panel one step through the z order. `swapZ` returns the
  // reordered array; only the target and its neighbour changed, so send just
  // those two `zIndex` values.
  function inspectorZ(dir: "forward" | "back") {
    const id = selectedPanelId;
    if (!id) return;
    const before = panelsRef.current;
    const swapped = swapZ(before, id, dir);
    const changed = swapped.filter((p) => {
      const prev = before.find((b) => b.id === p.id);
      return prev !== undefined && prev.zIndex !== p.zIndex;
    });
    if (changed.length === 0) return;
    const snapshot = before;
    setPanels(swapped);
    savePanels(
      changed.map((p) => ({ id: p.id, zIndex: p.zIndex })),
      () => setPanels(snapshot),
    );
  }

  // The server copy is offset one grid step down and right and lands on top of
  // the stack, so mirror both here. Without this optimistic append the copy is
  // written but never drawn: the `!pending` gate on the tree re-seed drops the
  // refreshed tree that carries it. The frame view-models are copied straight
  // from the source so the strip has something to show; the next re-seed
  // replaces them with the copy's own rows.
  function duplicateSelectedPanel() {
    const id = selectedPanelId;
    if (!id) return;
    const source = panelsRef.current.find((p) => p.id === id);
    if (!source) return;
    const zIndex = nextZIndex(panelsRef.current);
    startTransition(async () => {
      const result = await duplicatePanel(id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const copy: PanelVM = {
        ...source,
        id: result.id,
        x: source.x + DEFAULT_GRID,
        y: source.y + DEFAULT_GRID,
        zIndex,
        frames: source.frames.map((frame) => ({ ...frame })),
      };
      setPanels((current) =>
        current.some((p) => p.id === copy.id) ? current : [...current, copy],
      );
      setSelectedPanelId(result.id);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-4">
        <div className="rounded-panel border border-hairline bg-surface">
          <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
            <span className="text-sm font-medium text-ink">Panels</span>
            {canManage ? (
              <Button
                size="sm"
                variant="outline"
                onClick={addPanel}
                disabled={pending}
              >
                <Plus aria-hidden />
                Add panel
              </Button>
            ) : null}
          </div>
          {panels.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No panels yet. Use Add panel to place the first one.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {panels.map((panel, index) => {
                const label = panelLabel(panel, index);
                return (
                  <li key={panel.id}>
                    <button
                      type="button"
                      aria-label={`Select ${label}`}
                      aria-current={panel.id === selectedPanelId}
                      onClick={() => setSelectedPanelId(panel.id)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm",
                        panel.id === selectedPanelId
                          ? "bg-canvas text-ink"
                          : "text-body hover:bg-canvas",
                      )}
                    >
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">
                        {panel.width} x {panel.height}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="px-1 text-xs text-muted-foreground">
          {assets.length} media {assets.length === 1 ? "asset" : "assets"} ready
          for panel frames.
        </p>

        {selectedPanel ? (
          <PanelInspector
            panel={selectedPanel}
            canManage={canManage}
            onChange={inspectorChange}
            onCommit={inspectorCommit}
            onDelete={() => requestDelete(selectedPanel.id)}
            onDuplicate={duplicateSelectedPanel}
            onZ={inspectorZ}
          />
        ) : null}

        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings aria-hidden />
          Canvas settings
        </Button>
        <CanvasSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          canvas={tree}
          assets={assets}
          canManage={canManage}
        />
      </aside>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{tree.name}</span>
          <span className="text-xs text-muted-foreground">
            {tree.width} x {tree.height}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <div
              role="group"
              aria-label="Grid size"
              className="flex items-center gap-1"
            >
              {GRID_SIZES.map((size) => (
                <Button
                  key={size}
                  size="sm"
                  variant={size === gridSize ? "default" : "outline"}
                  aria-pressed={size === gridSize}
                  onClick={() => setGridSize(size)}
                >
                  {size === 1 ? "Off" : size}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              aria-pressed={showGrid}
              onClick={() => setShowGrid((v) => !v)}
            >
              {showGrid ? <Grid2x2Check aria-hidden /> : <Grid2x2 aria-hidden />}
              {showGrid ? "Grid on" : "Grid off"}
            </Button>

            {canManage && selectedPanel ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => requestDelete(selectedPanel.id)}
                disabled={pending}
              >
                <Trash2 aria-hidden />
                Delete panel
              </Button>
            ) : null}

            <Button
              size="sm"
              variant="outline"
              onClick={() => setPreviewOpen(true)}
            >
              <Play aria-hidden />
              Play
            </Button>
          </div>
        </div>

        <CanvasPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          canvasId={tree.id}
        />

        {confirmPanel ? (
          <div
            role="alertdialog"
            aria-label="Confirm panel delete"
            className="flex flex-wrap items-center gap-3 rounded-panel border border-hairline bg-muted/40 px-4 py-2 text-sm text-body"
          >
            <span>
              {panelLabel(
                confirmPanel,
                panels.findIndex((p) => p.id === confirmPanel.id),
              )}{" "}
              has {confirmPanel.frames.length}{" "}
              {confirmPanel.frames.length === 1 ? "frame" : "frames"}. Delete the
              panel and its frames?
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => performDelete(confirmPanel.id)}
                disabled={pending}
              >
                Delete panel
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmDeleteId(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <div className="overflow-auto rounded-panel border border-hairline bg-canvas p-4">
          <CanvasStage
            canvas={{
              width: tree.width,
              height: tree.height,
              backgroundColor: tree.backgroundColor,
              backgroundImageUrl: tree.backgroundImageUrl,
            }}
            panels={panels}
            scale={scale}
            selectedPanelId={selectedPanelId}
            gridSize={gridSize}
            showGrid={showGrid}
            guides={guides}
            mode="edit"
            onPanelPointerDown={handlePanelPointerDown}
            onResizeHandlePointerDown={
              canManage ? onResizeHandlePointerDown : undefined
            }
            renderFrame={(panel) => {
              const index = panels.findIndex((p) => p.id === panel.id);
              return (
                <div className="pointer-events-none flex h-full w-full items-center justify-center bg-navy/5 text-center text-xs text-body">
                  {/* In-panel frame rendering is play-mode work (Task 14); the
                      edit stage shows the panel label and its frame count. */}
                  <span className="px-1">
                    {panelLabel(panel, index)}
                    {panel.frames.length > 0
                      ? ` (${panel.frames.length})`
                      : ""}
                  </span>
                </div>
              );
            }}
          />
        </div>

        {selectedPanel ? (
          <FrameStrip
            panelId={selectedPanel.id}
            frames={selectedPanel.frames}
            selectedFrameId={selectedFrameId}
            onSelectFrame={setSelectedFrameId}
            canManage={canManage}
          />
        ) : null}

        {activeFrame ? (
          <FrameContentEditor
            frame={activeFrame}
            assets={assets}
            canManage={canManage}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Re-exported so Task 13 editors can share the frame `type` union. */
export type { FrameKind };
