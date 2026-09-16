/**
 * Pure Display Monkey -> LyneSign row mapping.
 *
 * This module has NO IO and NO database access on purpose: `map.test.ts`
 * exercises `mapDump` directly, and the migration script
 * (`scripts/migrate-displaymonkey.ts`) calls it between `readSource` and the
 * write transaction. Do not import `prisma`, `fs`, or anything with a side
 * effect here.
 *
 * Foreign keys are carried as legacy integer ids (`*LegacyId`). The migration
 * script resolves them to real cuids after each insert phase, because a pure
 * function cannot know the ids Postgres will assign.
 */
import type { FrameType, Role } from "@prisma/client";

/* -------------------------------------------------------------------------- */
/* Source shape (mirrors SQL/install.sql column names)                         */
/* -------------------------------------------------------------------------- */

export interface DmLevel {
  LevelId: number;
  Name: string;
}

export interface DmLocation {
  LocationId: number;
  LevelId: number;
  Name: string;
  AreaId: number | null;
  TemperatureUnit: string | null;
  Latitude: number | null;
  Longitude: number | null;
  DateFormat: string | null;
  TimeFormat: string | null;
  Woeid: number | null;
  Culture: string | null;
  TimeZone: string | null;
}

export interface DmDisplay {
  DisplayId: number;
  Name: string;
  Host: string | null;
  CanvasId: number;
  LocationId: number;
  NoScroll: boolean;
  ReadyTimeout: number;
  PollInterval: number;
  ErrorLength: number;
  NoCursor: boolean;
  RecycleTime: string | null;
}

export interface DmCanvas {
  CanvasId: number;
  Name: string;
  Height: number;
  Width: number;
  BackgroundImage: number | null;
  BackgroundColor: string | null;
}

export interface DmPanel {
  PanelId: number;
  CanvasId: number;
  Top: number;
  Left: number;
  Height: number;
  Width: number;
  Name: string;
  FadeLength: number;
}

export interface DmFrame {
  FrameId: number;
  PanelId: number;
  Duration: number;
  BeginsOn: string | null;
  EndsOn: string | null;
  Sort: number | null;
  TemplateId: number;
  CacheInterval: number;
  /**
   * Synthesized stand-in for DM `Template.FrameType`. Real Display Monkey has no
   * `Frame.Type` column; the frame's kind is derived from which detail table
   * holds its row (or `Template.FrameType`). A real extractor should populate
   * this from `Template.FrameType`. See `mapFrameType`.
   */
  Type: number;
}

export interface DmFrameLocation {
  FrameId: number;
  LocationId: number;
}

export interface DmContent {
  ContentId: number;
  Name: string | null;
  Type: number;
}

export interface DmClock {
  FrameId: number;
  Type: number;
  ShowDate: boolean;
  ShowTime: boolean;
  ShowSeconds: boolean;
  Label: string | null;
  TimeZone: string | null;
}

export interface DmPicture {
  FrameId: number;
  ContentId: number;
  Mode: number;
}

export interface DmHtml {
  FrameId: number;
  Name: string;
  Content: string;
}

export interface DmVideo {
  FrameId: number;
  ContentId?: number | null;
  PlayMuted: boolean;
  AutoLoop: boolean;
}

export interface DmYoutube {
  FrameId: number;
  Name: string;
  YoutubeId: string;
  Aspect: number;
  Quality: number;
  Rate: number;
}

export interface DmMemo {
  FrameId: number;
  Subject: string | null;
  Body: string | null;
}

export interface DmOutlook {
  FrameId: number;
  Mode: number;
  Privacy: number;
  AccountId: number | null;
}

export interface DmReport {
  FrameId: number;
  Path: string;
  Name: string;
  Mode: number;
  ServerId: number | null;
}

export interface DmPowerbi {
  FrameId: number;
  AccountId: number | null;
  Type: number | null;
  Url: string | null;
}

export interface DmWeather {
  FrameId: number;
  Type: number;
  Provider: number | null;
}

export interface DmNews {
  FrameId: number;
  Source: number;
  FeedUrl?: string | null;
}

export interface DmUser {
  uname: string;
  Pwd?: string;
  userRole: string;
}

export interface DmAzureAccount {
  AccountId: number;
  Name: string;
  Resource: number;
  ClientId: string;
  ClientSecret: string;
  TenantId: string | null;
  User: string | null;
}

export interface DmExchangeAccount {
  AccountId: number;
  Name: string;
  Account: string;
  Url: string | null;
}

export interface DmOauthAccount {
  AccountId: number;
  Provider: number;
  Name: string;
  AppId: string;
  ClientId: string;
  ClientSecret: string;
}

export interface DmReportServer {
  ServerId: number;
  Name: string;
  BaseUrl: string;
  User: string | null;
  Domain: string | null;
}

export interface DmDump {
  levels: DmLevel[];
  locations: DmLocation[];
  displays: DmDisplay[];
  canvases: DmCanvas[];
  panels: DmPanel[];
  frames: DmFrame[];
  frameLocations: DmFrameLocation[];
  content: DmContent[];
  clocks: DmClock[];
  pictures: DmPicture[];
  htmls: DmHtml[];
  videos: DmVideo[];
  youtubes: DmYoutube[];
  memos: DmMemo[];
  outlooks: DmOutlook[];
  reports: DmReport[];
  powerbis: DmPowerbi[];
  weathers: DmWeather[];
  newsItems: DmNews[];
  users: DmUser[];
  azureAccounts: DmAzureAccount[];
  exchangeAccounts: DmExchangeAccount[];
  oauthAccounts: DmOauthAccount[];
  reportServers: DmReportServer[];
}

/** Empty dump — every array defaulted. Handy for `readSource` and tests. */
export function emptyDump(): DmDump {
  return {
    levels: [],
    locations: [],
    displays: [],
    canvases: [],
    panels: [],
    frames: [],
    frameLocations: [],
    content: [],
    clocks: [],
    pictures: [],
    htmls: [],
    videos: [],
    youtubes: [],
    memos: [],
    outlooks: [],
    reports: [],
    powerbis: [],
    weathers: [],
    newsItems: [],
    users: [],
    azureAccounts: [],
    exchangeAccounts: [],
    oauthAccounts: [],
    reportServers: [],
  };
}

/** Coerce an arbitrary parsed object into a `DmDump` with all arrays present. */
export function normalizeDump(raw: unknown): DmDump {
  const base = emptyDump();
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(base) as (keyof DmDump)[]) {
      const value = (raw as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        (base[key] as unknown[]) = value;
      }
    }
  }
  return base;
}

/* -------------------------------------------------------------------------- */
/* Destination shape                                                           */
/* -------------------------------------------------------------------------- */

export interface MappedLocation {
  legacyId: number;
  /** Real DM `Location.LevelId`-derived parent legacyId, or null for the Level. */
  parentLegacyId: number | null;
  /**
   * Placeholder the pure mapping can produce without a database: `null` for the
   * synthetic Level-as-parent row, and the stringified parent legacyId for a
   * child. The migration script overwrites this with the parent's real cuid.
   */
  parentId: string | null;
  organizationId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  timeZone: string;
  locale: string;
  temperatureUnit: string | null;
}

export interface MappedScreen {
  legacyId: number;
  organizationId: string;
  name: string;
  locationLegacyId: number;
  canvasLegacyId: number | null;
  status: "UNPAIRED";
  pollIntervalSeconds: number;
  orientation: string | null;
  notes: string | null;
}

export interface MappedCanvas {
  legacyId: number;
  organizationId: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string | null;
}

export interface MappedPanel {
  legacyId: number;
  organizationId: string;
  canvasLegacyId: number;
  name: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  noScroll: boolean;
}

export interface MappedFrame {
  legacyId: number;
  organizationId: string;
  panelLegacyId: number;
  sortOrder: number;
  durationSeconds: number;
  type: FrameType;
  locationScoped: boolean;
}

export interface MappedFrameLocation {
  organizationId: string;
  frameLegacyId: number;
  locationLegacyId: number;
}

export interface MappedContent {
  legacyId: number;
  organizationId: string;
  frameLegacyId: number;
  name: string | null;
}

export type MappedTyped =
  | { kind: "clock"; frameLegacyId: number; organizationId: string; data: Record<string, unknown> }
  | { kind: "picture"; frameLegacyId: number; organizationId: string; data: Record<string, unknown> }
  | { kind: "video"; frameLegacyId: number; organizationId: string; data: Record<string, unknown> }
  | { kind: "youtube"; frameLegacyId: number; organizationId: string; data: Record<string, unknown> }
  | { kind: "html"; frameLegacyId: number; organizationId: string; data: Record<string, unknown> }
  | { kind: "memo"; frameLegacyId: number; organizationId: string; data: Record<string, unknown> }
  | { kind: "outlook"; frameLegacyId: number; organizationId: string; data: Record<string, unknown> }
  | { kind: "report"; frameLegacyId: number; organizationId: string; data: Record<string, unknown> }
  | { kind: "powerbi"; frameLegacyId: number; organizationId: string; data: Record<string, unknown> }
  | { kind: "weather"; frameLegacyId: number; organizationId: string; data: Record<string, unknown> }
  | { kind: "news"; frameLegacyId: number; organizationId: string; data: Record<string, unknown> };

export interface MappedUser {
  /** Original DM `uname`, kept for logging/reconciliation only. */
  uname: string;
  user: {
    email: string;
    name: string;
    hashedPassword: null;
    mustResetPassword: true;
  };
  membership: {
    role: Role;
  };
}

export interface MappedLegacyIntegration {
  legacyId: number;
  organizationId: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface MappedRows {
  locations: MappedLocation[];
  screens: MappedScreen[];
  canvases: MappedCanvas[];
  panels: MappedPanel[];
  frames: MappedFrame[];
  frameLocations: MappedFrameLocation[];
  content: MappedContent[];
  typed: MappedTyped[];
  users: MappedUser[];
  legacyIntegrations: MappedLegacyIntegration[];
}

/* -------------------------------------------------------------------------- */
/* Scalar mappers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Namespaced legacyId for the synthetic Location that a DM `Level` becomes.
 * DM `Location.LocationId` is a positive identity; Levels get a large negative
 * legacyId (`LEVEL_LEGACY_BASE - LevelId`) so the two never collide in
 * `Location.legacyId @unique`.
 */
export const LEVEL_LEGACY_BASE = -1_000_000;

export function levelLegacyId(levelId: number): number {
  return LEVEL_LEGACY_BASE - levelId;
}

/**
 * Map a Display Monkey frame-type integer to the LyneSign `FrameType` enum.
 *
 * IMPORTANT: the integers here follow the brief's simplified fixture convention
 * (`0 -> CLOCK`, `1 -> PICTURE`, `4 -> HTML`), which is exercised by
 * `map.test.ts`. It does NOT match Display Monkey's real `FrameTypes` enum
 * (Management/FrameTypes.cs):
 *
 *     Clock=0, Html=1, Memo=2, (News=3 reserved), Outlook=4,
 *     Picture=5, Report=6, Video=7, Weather=8, YouTube=9, Powerbi=10
 *
 * Before a real-data run, populate `DmFrame.Type` from `Template.FrameType` and
 * switch this table to the enum above.
 */
const FRAME_TYPE_BY_DM_INT: Readonly<Record<number, FrameType>> = {
  0: "CLOCK",
  1: "PICTURE",
  4: "HTML",
};

export function mapFrameType(n: number): FrameType {
  const mapped = FRAME_TYPE_BY_DM_INT[n];
  if (!mapped) {
    throw new Error(`mapFrameType: unmapped Display Monkey frame type ${n}`);
  }
  return mapped;
}

/** `"admin"` (any case) -> `ADMIN`; everything else -> `VIEWER`. */
export function mapUserRole(s: string): Role {
  return s.trim().toLowerCase() === "admin" ? "ADMIN" : "VIEWER";
}

/**
 * Deterministic synthetic email for a DM user. DM `Users` has no email column;
 * `uname` is unique per DM install. The organizationId keeps it unique across
 * imports into different orgs and makes re-runs idempotent (upsert by email).
 */
export function syntheticUserEmail(uname: string, organizationId: string): string {
  const local = uname.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return `dm.${local}.${organizationId}@import.lynesign.local`;
}

/* -------------------------------------------------------------------------- */
/* Typed detail rows                                                           */
/* -------------------------------------------------------------------------- */

function buildTyped(dump: DmDump, frame: DmFrame, organizationId: string): MappedTyped | null {
  const frameLegacyId = frame.FrameId;
  const type = mapFrameType(frame.Type);

  switch (type) {
    case "CLOCK": {
      const src = dump.clocks.find((c) => c.FrameId === frame.FrameId);
      return {
        kind: "clock",
        frameLegacyId,
        organizationId,
        data: {
          type: src?.Type ?? 0,
          showDate: src?.ShowDate ?? true,
          showTime: src?.ShowTime ?? true,
          showSeconds: src?.ShowSeconds ?? true,
          label: src?.Label ?? null,
          timeZone: src?.TimeZone ?? null,
        },
      };
    }
    case "PICTURE": {
      const src = dump.pictures.find((p) => p.FrameId === frame.FrameId);
      return {
        kind: "picture",
        frameLegacyId,
        organizationId,
        // DM stores the image as a binary blob in Content.Data; blobs are not
        // migrated. mediaRef keeps a stable reference to the legacy asset id.
        data: {
          mediaRef: src ? `legacy-content:${src.ContentId}` : null,
          mode: src ? String(src.Mode) : null,
        },
      };
    }
    case "HTML": {
      const src = dump.htmls.find((h) => h.FrameId === frame.FrameId);
      return { kind: "html", frameLegacyId, organizationId, data: { body: src?.Content ?? "" } };
    }
    case "VIDEO": {
      const src = dump.videos.find((v) => v.FrameId === frame.FrameId);
      return {
        kind: "video",
        frameLegacyId,
        organizationId,
        data: { mediaRef: src?.ContentId ? `legacy-content:${src.ContentId}` : null },
      };
    }
    case "YOUTUBE": {
      const src = dump.youtubes.find((y) => y.FrameId === frame.FrameId);
      return {
        kind: "youtube",
        frameLegacyId,
        organizationId,
        data: {
          videoId: src?.YoutubeId ?? "",
          aspect: src ? String(src.Aspect) : null,
          quality: src ? String(src.Quality) : null,
          rate: src ? String(src.Rate) : null,
        },
      };
    }
    case "MEMO": {
      const src = dump.memos.find((m) => m.FrameId === frame.FrameId);
      return { kind: "memo", frameLegacyId, organizationId, data: { body: src?.Body ?? "" } };
    }
    case "OUTLOOK": {
      const src = dump.outlooks.find((o) => o.FrameId === frame.FrameId);
      return {
        kind: "outlook",
        frameLegacyId,
        organizationId,
        data: {
          mode: src?.Mode ?? 0,
          privacy: src?.Privacy ?? 0,
          accountRef: src?.AccountId != null ? `legacy-account:${src.AccountId}` : null,
        },
      };
    }
    case "REPORT": {
      const src = dump.reports.find((r) => r.FrameId === frame.FrameId);
      return {
        kind: "report",
        frameLegacyId,
        organizationId,
        data: {
          path: src?.Path ?? "",
          mode: src?.Mode ?? 0,
          serverRef: src?.ServerId != null ? `legacy-server:${src.ServerId}` : null,
        },
      };
    }
    case "POWERBI": {
      const src = dump.powerbis.find((p) => p.FrameId === frame.FrameId);
      return {
        kind: "powerbi",
        frameLegacyId,
        organizationId,
        data: {
          url: src?.Url ?? "",
          type: src?.Type ?? 0,
          accountRef: src?.AccountId != null ? `legacy-account:${src.AccountId}` : null,
        },
      };
    }
    case "WEATHER": {
      const src = dump.weathers.find((w) => w.FrameId === frame.FrameId);
      return {
        kind: "weather",
        frameLegacyId,
        organizationId,
        data: { type: src?.Type ?? 0, provider: src?.Provider ?? 0 },
      };
    }
    case "NEWS": {
      const src = dump.newsItems.find((n) => n.FrameId === frame.FrameId);
      return { kind: "news", frameLegacyId, organizationId, data: { feedUrl: src?.FeedUrl ?? "" } };
    }
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Top-level mapper                                                            */
/* -------------------------------------------------------------------------- */

export function mapDump(rawDump: DmDump, ctx: { organizationId: string }): MappedRows {
  const dump = normalizeDump(rawDump);
  const { organizationId } = ctx;

  // Level -> parent Location.
  const levelLocations: MappedLocation[] = dump.levels.map((level) => ({
    legacyId: levelLegacyId(level.LevelId),
    parentLegacyId: null,
    parentId: null,
    organizationId,
    name: level.Name,
    latitude: null,
    longitude: null,
    timeZone: "UTC",
    locale: "en-US",
    temperatureUnit: null,
  }));

  // DM Location -> child Location, parented to its Level's synthetic Location.
  const childLocations: MappedLocation[] = dump.locations.map((loc) => {
    const parentLegacyId = levelLegacyId(loc.LevelId);
    return {
      legacyId: loc.LocationId,
      parentLegacyId,
      parentId: String(parentLegacyId),
      organizationId,
      name: loc.Name,
      latitude: loc.Latitude ?? null,
      longitude: loc.Longitude ?? null,
      timeZone: loc.TimeZone ?? "UTC",
      locale: loc.Culture ?? "en-US",
      temperatureUnit: loc.TemperatureUnit ?? null,
    };
  });

  const screens: MappedScreen[] = dump.displays.map((d) => ({
    legacyId: d.DisplayId,
    organizationId,
    name: d.Name,
    locationLegacyId: d.LocationId,
    canvasLegacyId: d.CanvasId ?? null,
    status: "UNPAIRED",
    // DM PollInterval of 0 means "use the server default"; LyneSign's column
    // default is 60s.
    pollIntervalSeconds: d.PollInterval && d.PollInterval > 0 ? d.PollInterval : 60,
    orientation: null,
    notes: null,
  }));

  const canvases: MappedCanvas[] = dump.canvases.map((c) => ({
    legacyId: c.CanvasId,
    organizationId,
    name: c.Name,
    width: c.Width,
    height: c.Height,
    backgroundColor: c.BackgroundColor ?? null,
  }));

  const panels: MappedPanel[] = dump.panels.map((p) => ({
    legacyId: p.PanelId,
    organizationId,
    canvasLegacyId: p.CanvasId,
    name: p.Name ?? null,
    x: p.Left,
    y: p.Top,
    width: p.Width,
    height: p.Height,
    zIndex: 0,
    noScroll: false,
  }));

  const frameHasLocations = new Set(dump.frameLocations.map((fl) => fl.FrameId));
  const frames: MappedFrame[] = dump.frames.map((f) => ({
    legacyId: f.FrameId,
    organizationId,
    panelLegacyId: f.PanelId,
    sortOrder: f.Sort ?? 0,
    durationSeconds: f.Duration,
    type: mapFrameType(f.Type),
    locationScoped: frameHasLocations.has(f.FrameId),
  }));

  const frameLocations: MappedFrameLocation[] = dump.frameLocations.map((fl) => ({
    organizationId,
    frameLegacyId: fl.FrameId,
    locationLegacyId: fl.LocationId,
  }));

  // One LyneSign Content wrapper per DM Frame. Content.legacyId reuses the DM
  // FrameId (a different @unique column from Frame.legacyId, so no collision).
  const content: MappedContent[] = dump.frames.map((f) => {
    const html = dump.htmls.find((h) => h.FrameId === f.FrameId);
    const pic = dump.pictures.find((p) => p.FrameId === f.FrameId);
    const asset = pic ? dump.content.find((c) => c.ContentId === pic.ContentId) : undefined;
    return {
      legacyId: f.FrameId,
      organizationId,
      frameLegacyId: f.FrameId,
      name: html?.Name ?? asset?.Name ?? null,
    };
  });

  const typed: MappedTyped[] = [];
  for (const f of dump.frames) {
    const row = buildTyped(dump, f, organizationId);
    if (row) typed.push(row);
  }

  const users: MappedUser[] = dump.users.map((u) => ({
    uname: u.uname,
    user: {
      email: syntheticUserEmail(u.uname, organizationId),
      name: u.uname,
      hashedPassword: null,
      mustResetPassword: true,
    },
    membership: { role: mapUserRole(u.userRole) },
  }));

  // Integration accounts -> LegacyIntegration rows. Secret-bearing fields are
  // dropped from the fixture payload and marked; a real migration re-encrypts
  // them with APP_ENCRYPTION_KEY before they land in `payload`.
  const legacyIntegrations: MappedLegacyIntegration[] = [];
  for (const a of dump.azureAccounts) {
    legacyIntegrations.push({
      legacyId: a.AccountId,
      organizationId,
      kind: "azure",
      payload: {
        name: a.Name,
        resource: a.Resource,
        clientId: a.ClientId,
        tenantId: a.TenantId ?? null,
        user: a.User ?? null,
        clientSecret: { encrypted: false, note: "re-encrypt DM ClientSecret with APP_ENCRYPTION_KEY on a real run" },
      },
    });
  }
  for (const e of dump.exchangeAccounts) {
    legacyIntegrations.push({
      legacyId: 100_000 + e.AccountId,
      organizationId,
      kind: "exchange",
      payload: {
        name: e.Name,
        account: e.Account,
        url: e.Url ?? null,
        password: { encrypted: false, note: "re-encrypt DM Password with APP_ENCRYPTION_KEY on a real run" },
      },
    });
  }
  for (const o of dump.oauthAccounts) {
    legacyIntegrations.push({
      legacyId: 200_000 + o.AccountId,
      organizationId,
      kind: "oauth",
      payload: {
        name: o.Name,
        provider: o.Provider,
        appId: o.AppId,
        clientId: o.ClientId,
        clientSecret: { encrypted: false, note: "re-encrypt DM ClientSecret with APP_ENCRYPTION_KEY on a real run" },
      },
    });
  }
  for (const r of dump.reportServers) {
    legacyIntegrations.push({
      legacyId: 300_000 + r.ServerId,
      organizationId,
      kind: "report-server",
      payload: {
        name: r.Name,
        baseUrl: r.BaseUrl,
        user: r.User ?? null,
        domain: r.Domain ?? null,
        password: { encrypted: false, note: "re-encrypt DM Password with APP_ENCRYPTION_KEY on a real run" },
      },
    });
  }

  return {
    locations: [...levelLocations, ...childLocations],
    screens,
    canvases,
    panels,
    frames,
    frameLocations,
    content,
    typed,
    users,
    legacyIntegrations,
  };
}
