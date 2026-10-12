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

test("assets cannot point at another tenant's storage prefix", async () => {
  const other = await makeUser(`share-other-${run}@test.dev`);
  const { data: p } = await client.from("projects").select("org_id").eq("id", projectId).single();
  const { error } = await client.from("assets").insert({
    org_id: p!.org_id, project_id: projectId, kind: "model",
    storage_path: `${other.orgId}/${projectId}/1-file.glb`, filename: "file.glb",
  });
  expect(error).not.toBeNull();
  const { error: ownOk } = await client.from("assets").insert({
    org_id: p!.org_id, project_id: projectId, kind: "export",
    storage_path: `${p!.org_id}/${projectId}/1-file.glb`, filename: "file.glb",
  });
  expect(ownOk).toBeNull();
});

test("a viewer cannot create a share link", async () => {
  const owner = await makeUser(`share-own2-${run}@test.dev`);
  const { data: p } = await owner.client.from("projects").insert({ org_id: owner.orgId, name: "V" }).select().single();
  const v = await makeUser(`share-viewer-${run}@test.dev`);
  await admin().from("memberships").insert({ org_id: owner.orgId, user_id: v.userId, role: "viewer" });
  const { data } = await v.client.from("projects").update({ share_token: "c".repeat(32) }).eq("id", p!.id).is("share_token", null).select("id");
  expect(data ?? []).toHaveLength(0);
});
