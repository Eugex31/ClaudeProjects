import { beforeAll, expect, test } from "vitest";
import { admin, makeUser } from "./helpers";
import { loadSharedProject } from "@/lib/data/share";

const run = Date.now();
let projectId: string;
let client: Awaited<ReturnType<typeof makeUser>>["client"];
const token = "a".repeat(16) + String(run).padStart(16, "0").slice(-16);

beforeAll(async () => {
  const u = await makeUser(`share-${run}@test.dev`);
  client = u.client;
  const { data: p } = await client.from("projects").insert({ org_id: u.orgId, name: "Shared" }).select().single();
  projectId = p!.id;
  await client.from("storyboards").insert({ project_id: projectId, org_id: u.orgId, steps: [{ id: "s", title: "T", narration: "", parts: [], from: "above", camera: "iso" }] });
  await client.from("assets").insert({ org_id: u.orgId, project_id: projectId, kind: "model", storage_path: "sample:bookshelf.glb", filename: "bookshelf.glb" });
  await client.from("projects").update({ share_token: token }).eq("id", projectId);
});

test("draft project is not shared", async () => {
  expect(await loadSharedProject(token, admin())).toBeNull();
});

test("approved project is shared with only player data", async () => {
  await client.from("projects").update({ status: "approved" }).eq("id", projectId);
  const shared = await loadSharedProject(token, admin());
  expect(shared).toMatchObject({ name: "Shared", language: "en", modelUrl: "/sample/bookshelf.glb" });
  expect(Object.keys(shared!).sort()).toEqual(["language", "modelUrl", "name", "parts", "steps"]);
});

test("revoked token is not shared", async () => {
  await client.from("projects").update({ share_token: null }).eq("id", projectId);
  expect(await loadSharedProject(token, admin())).toBeNull();
});

test("malformed tokens are rejected without a query", async () => {
  expect(await loadSharedProject("short", admin())).toBeNull();
});
