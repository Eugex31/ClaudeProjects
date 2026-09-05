/**
 * Source reader for the Display Monkey migration.
 *
 * Two paths:
 *  - `fixture`: read a JSON dump from disk (fully working, exercised by tests).
 *  - `mssqlUrl`: query a live Display Monkey SQL Server. `mssql` is loaded with a
 *    DYNAMIC import so it is NOT a hard dependency of this repo -- `npm ci` and
 *    the test run never need the package. This path is written from the DM
 *    schema (SQL/install.sql) but is UNTESTED against a real database; it is
 *    documented as "validated against fixture, pending a real-data run".
 */
import { readFileSync } from "node:fs";
import { normalizeDump, type DmDump } from "./map";

export interface ReadSourceOptions {
  mssqlUrl?: string;
  fixture?: string;
}

export async function readSource(opts: ReadSourceOptions): Promise<DmDump> {
  if (opts.fixture) {
    const raw = JSON.parse(readFileSync(opts.fixture, "utf8")) as unknown;
    return normalizeDump(raw);
  }
  if (opts.mssqlUrl) {
    return readFromMssql(opts.mssqlUrl);
  }
  throw new Error("readSource: provide either `fixture` or `mssqlUrl`");
}

/* -------------------------------------------------------------------------- */
/* Live SQL Server path (dynamic import, untested against real data)           */
/* -------------------------------------------------------------------------- */

interface MssqlRequest {
  query<T = Record<string, unknown>>(sql: string): Promise<{ recordset: T[] }>;
}
interface MssqlPool {
  request(): MssqlRequest;
  close(): Promise<void>;
}
interface MssqlModule {
  connect(config: string): Promise<MssqlPool>;
}

/** Best-effort SELECTs, one per DM table. Column lists follow SQL/install.sql. */
const QUERIES: Record<keyof DmDump, string | null> = {
  levels: "SELECT LevelId, Name FROM dbo.[Level]",
  locations:
    "SELECT LocationId, LevelId, Name, AreaId, TemperatureUnit, Latitude, Longitude, DateFormat, TimeFormat, Woeid, Culture, TimeZone FROM dbo.Location",
  displays:
    "SELECT DisplayId, Name, Host, CanvasId, LocationId, NoScroll, ReadyTimeout, PollInterval, ErrorLength, NoCursor, CONVERT(varchar(16), RecycleTime) AS RecycleTime FROM dbo.Display",
  canvases: "SELECT CanvasId, Name, Height, Width, BackgroundImage, BackgroundColor FROM dbo.Canvas",
  panels: "SELECT PanelId, CanvasId, [Top], [Left], Height, Width, Name, FadeLength FROM dbo.Panel",
  // Real DM has no Frame.Type column; FrameType comes from Template.FrameType.
  frames:
    "SELECT f.FrameId, f.PanelId, f.Duration, CONVERT(varchar(33), f.BeginsOn, 126) AS BeginsOn, CONVERT(varchar(33), f.EndsOn, 126) AS EndsOn, f.Sort, f.TemplateId, f.CacheInterval, t.FrameType AS Type FROM dbo.Frame f LEFT JOIN dbo.Template t ON t.TemplateId = f.TemplateId",
  frameLocations: "SELECT FrameId, LocationId FROM dbo.FrameLocation",
  content: "SELECT ContentId, Name, Type FROM dbo.Content",
  clocks: "SELECT FrameId, Type, ShowDate, ShowTime, ShowSeconds, Label, TimeZone FROM dbo.Clock",
  pictures: "SELECT FrameId, ContentId, Mode FROM dbo.Picture",
  htmls: "SELECT FrameId, Name, Content FROM dbo.Html",
  videos: "SELECT FrameId, PlayMuted, AutoLoop FROM dbo.Video",
  youtubes: "SELECT FrameId, Name, YoutubeId, Aspect, Quality, Rate FROM dbo.Youtube",
  memos: "SELECT FrameId, Subject, Body FROM dbo.Memo",
  outlooks: "SELECT FrameId, Mode, Privacy, AccountId FROM dbo.Outlook",
  reports: "SELECT FrameId, Path, Name, Mode, ServerId FROM dbo.Report",
  powerbis: "SELECT FrameId, AccountId, Type, Url FROM dbo.Powerbi",
  weathers: "SELECT FrameId, Type, Provider FROM dbo.Weather",
  newsItems: "SELECT FrameId, Source FROM dbo.News",
  users: "SELECT uname, userRole FROM dbo.Users",
  azureAccounts: "SELECT AccountId, Name, Resource, ClientId, ClientSecret, TenantId, [User] FROM dbo.AzureAccount",
  exchangeAccounts: "SELECT AccountId, Name, Account, Url FROM dbo.ExchangeAccount",
  oauthAccounts: "SELECT AccountId, Provider, Name, AppId, ClientId, ClientSecret FROM dbo.OauthAccount",
  reportServers: "SELECT ServerId, Name, BaseUrl, [User], Domain FROM dbo.ReportServer",
};

async function readFromMssql(mssqlUrl: string): Promise<DmDump> {
  // Variable specifier so TypeScript does not try to resolve the (optional,
  // not-installed) `mssql` package at build time.
  const specifier: string = "mssql";
  let mod: MssqlModule;
  try {
    mod = (await import(specifier)) as unknown as MssqlModule;
  } catch {
    throw new Error(
      "readSource: the live SQL Server path needs the optional `mssql` package. Install it with `npm i -D mssql` and retry, or use --fixture.",
    );
  }

  const pool = await mod.connect(mssqlUrl);
  try {
    const dump = normalizeDump({});
    for (const key of Object.keys(QUERIES) as (keyof DmDump)[]) {
      const sql = QUERIES[key];
      if (!sql) continue;
      try {
        const { recordset } = await pool.request().query(sql);
        (dump[key] as unknown[]) = recordset;
      } catch (err) {
        // A DM install may lack a table (e.g. OauthAccount on older schemas).
        // Skip it rather than aborting the whole extraction.
        console.warn(`readSource(mssql): skipping ${key}: ${(err as Error).message}`);
      }
    }
    return dump;
  } finally {
    await pool.close();
  }
}
