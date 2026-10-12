import { beforeAll, expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, approveCurrent, localEnv, makeUser } from "./helpers";

const run = Date.now();
let owner: Awaited<ReturnType<typeof makeUser>>;
let projectId: string;

beforeAll(async () => {
  owner = await makeUser(`appr-${run}@test.dev`);
  const { data: p, error } = await owner.client.from("projects").insert({ org_id: owner.orgId, name: "Approve me" }).select().single();
  if (error) throw error;
  projectId = p.id;
  const sb = await owner.client.from("storyboards").insert({ project_id: projectId, org_id: owner.orgId, steps: [{ id: "s1" }] });
  if (sb.error) throw sb.error;
});

test("approving with a stale storyboard version fails", async () => {
  const { data: before } = await owner.client.from("storyboards").select("updated_at").eq("project_id", projectId).single();
  await owner.client.from("storyboards").update({ steps: [{ id: "s1" }, { id: "s2" }] }).eq("project_id", projectId);
  const { error } = await owner.client.rpc("approve_project", { p_project: projectId, p_storyboard_updated_at: before!.updated_at });
  expect(error?.message).toMatch(/storyboard changed since you loaded it/);
  const { data } = await admin().from("projects").select("status").eq("id", projectId).single();
  expect(data!.status).toBe("draft");
});

test("approving with the current version succeeds and stamps the approver", async () => {
  const { data, error } = await approveCurrent(owner.client, projectId);
  expect(error).toBeNull();
  expect(data).toBe("approved");
  const { data: p } = await admin().from("projects").select("status, approved_by").eq("id", projectId).single();
  expect(p).toEqual({ status: "approved", approved_by: owner.userId });
});

test("editors cannot set status directly", async () => {
  await admin().from("projects").update({ status: "draft" }).eq("id", projectId);
  const { error } = await owner.client.from("projects").update({ status: "approved" }).eq("id", projectId);
  expect(error).not.toBeNull();
  const { data } = await admin().from("projects").select("status").eq("id", projectId).single();
  expect(data!.status).toBe("draft");
});

test("a viewer cannot approve via the RPC", async () => {
  const v = await makeUser(`appr-viewer-${run}@test.dev`);
  await admin().from("memberships").insert({ org_id: owner.orgId, user_id: v.userId, role: "viewer" });
  const { error } = await approveCurrent(v.client, projectId);
  expect(error?.message).toMatch(/Not permitted/);
  const { data } = await admin().from("projects").select("status").eq("id", projectId).single();
  expect(data!.status).toBe("draft");
});

test("a member of another org cannot approve", async () => {
  const other = await makeUser(`appr-other-${run}@test.dev`);
  const { data: sb } = await admin().from("storyboards").select("updated_at").eq("project_id", projectId).single();
  const { error } = await other.client.rpc("approve_project", { p_project: projectId, p_storyboard_updated_at: sb!.updated_at });
  expect(error?.message).toMatch(/Not permitted/);
  const { data } = await admin().from("projects").select("status").eq("id", projectId).single();
  expect(data!.status).toBe("draft");
});

test("anon cannot call approve_project", async () => {
  const anon = createClient(localEnv().url, localEnv().anonKey, { auth: { persistSession: false } });
  const { error } = await anon.rpc("approve_project", { p_project: projectId, p_storyboard_updated_at: new Date().toISOString() });
  expect(error).not.toBeNull();
});
