import { beforeAll, describe, expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, localEnv, makeUser } from "./helpers";

const run = Date.now();
let a: Awaited<ReturnType<typeof makeUser>>;
let b: Awaited<ReturnType<typeof makeUser>>;
let projectB: string;

beforeAll(async () => {
  a = await makeUser(`a-${run}@test.dev`);
  b = await makeUser(`b-${run}@test.dev`);
  const { data, error } = await b.client.from("projects").insert({ org_id: b.orgId, name: "B secret" }).select().single();
  if (error) throw error;
  projectB = data.id;
  const sb = await b.client.from("storyboards").insert({ project_id: projectB, org_id: b.orgId, steps: [{ id: "s" }] });
  if (sb.error) throw sb.error;
  const up = await b.client.storage.from("org-files").upload(`${b.orgId}/${projectB}/x-secret.txt`, new Blob(["secret"]));
  if (up.error) throw up.error;
});

describe("tenant isolation", () => {
  test("signup created an org with an owner membership", () => {
    expect(a.orgId).toBeTruthy();
    expect(a.orgId).not.toBe(b.orgId);
  });

  test("A cannot read B's projects or storyboards", async () => {
    const { data: p } = await a.client.from("projects").select().eq("id", projectB);
    expect(p).toEqual([]);
    const { data: s } = await a.client.from("storyboards").select().eq("project_id", projectB);
    expect(s).toEqual([]);
  });

  test("A cannot update B's project", async () => {
    await a.client.from("projects").update({ name: "pwned" }).eq("id", projectB);
    const { data } = await admin().from("projects").select("name").eq("id", projectB).single();
    expect(data!.name).toBe("B secret");
  });

  test("A cannot insert a storyboard pointing at B's project", async () => {
    const { error } = await a.client.from("storyboards").insert({ project_id: projectB, org_id: a.orgId });
    expect(error).not.toBeNull();
  });

  test("A cannot read or write B's files", async () => {
    const { data } = await a.client.storage.from("org-files").download(`${b.orgId}/${projectB}/x-secret.txt`);
    expect(data).toBeNull();
    const { error } = await a.client.storage.from("org-files").upload(`${b.orgId}/${projectB}/evil.txt`, new Blob(["x"]));
    expect(error).not.toBeNull();
  });

  test("owners cannot change their own plan or quota", async () => {
    const { error } = await a.client.from("organizations").update({ monthly_generation_quota: 9999 }).eq("id", a.orgId);
    expect(error).not.toBeNull();
  });

  test("viewers cannot edit projects", async () => {
    const v = await makeUser(`v-${run}@test.dev`);
    await admin().from("memberships").insert({ org_id: b.orgId, user_id: v.userId, role: "viewer" });
    await v.client.from("projects").update({ name: "viewer edit" }).eq("id", projectB);
    const { data } = await admin().from("projects").select("name").eq("id", projectB).single();
    expect(data!.name).toBe("B secret");
  });

  test("users cannot increment usage directly", async () => {
    const { error } = await a.client.rpc("increment_usage", { target_org: a.orgId, target_period: "2026-10" });
    expect(error).not.toBeNull();
  });
});

describe("approval workflow", () => {
  test("approve stamps approver; editing steps resets to draft", async () => {
    const { data: ok } = await b.client.from("projects").update({ status: "approved" }).eq("id", projectB).select().single();
    expect(ok!.approved_by).toBe(b.userId);
    await b.client.from("storyboards").update({ steps: [{ id: "s2" }] }).eq("project_id", projectB);
    const { data } = await b.client.from("projects").select("status, approved_by").eq("id", projectB).single();
    expect(data).toEqual({ status: "draft", approved_by: null });
  });

  test("cannot approve with zero steps", async () => {
    const { data: p } = await b.client.from("projects").insert({ org_id: b.orgId, name: "empty" }).select().single();
    await b.client.from("storyboards").insert({ project_id: p!.id, org_id: b.orgId });
    const { error } = await b.client.from("projects").update({ status: "approved" }).eq("id", p!.id);
    expect(error?.message).toMatch(/no steps/);
  });
});

describe("approval hardening", () => {
  test("cannot insert a project already approved", async () => {
    const { data, error } = await b.client
      .from("projects")
      .insert({ org_id: b.orgId, name: "forged", status: "approved", approved_by: b.userId })
      .select()
      .single();
    expect(error !== null || data!.status === "draft").toBe(true);
  });

  test("cannot re-key a storyboard to another project", async () => {
    const { data: p1 } = await b.client.from("projects").insert({ org_id: b.orgId, name: "p1" }).select().single();
    const { data: p2 } = await b.client.from("projects").insert({ org_id: b.orgId, name: "p2" }).select().single();
    await b.client.from("storyboards").insert({ project_id: p1!.id, org_id: b.orgId, steps: [{ id: "x" }] });
    const { error } = await b.client.from("storyboards").update({ project_id: p2!.id }).eq("project_id", p1!.id);
    expect(error).not.toBeNull();
    const { data } = await admin().from("storyboards").select("project_id").eq("project_id", p1!.id);
    expect(data).toHaveLength(1);
  });

  test("inserting a storyboard for an approved project resets it to draft", async () => {
    const { data: p } = await b.client.from("projects").insert({ org_id: b.orgId, name: "p3" }).select().single();
    await admin().from("storyboards").insert({ project_id: p!.id, org_id: b.orgId, steps: [{ id: "x" }] });
    await admin().from("projects").update({ status: "approved", approved_by: b.userId }).eq("id", p!.id);
    await admin().from("storyboards").delete().eq("project_id", p!.id);
    const { error } = await b.client.from("storyboards").insert({ project_id: p!.id, org_id: b.orgId, steps: [{ id: "new" }] });
    expect(error).toBeNull();
    const { data } = await admin().from("projects").select("status, approved_by").eq("id", p!.id).single();
    expect(data).toEqual({ status: "draft", approved_by: null });
  });

  test("anon cannot call accept_invite", async () => {
    const anon = createClient(localEnv().url, localEnv().anonKey, { auth: { persistSession: false } });
    const { error } = await anon.rpc("accept_invite", { invite_token: "x" });
    expect(error).not.toBeNull();
  });

  test("authenticated cannot write usage directly", async () => {
    const { error } = await a.client.from("usage").insert({ org_id: a.orgId, period: "2026-10", generations: 0 });
    expect(error).not.toBeNull();
  });
});

describe("invites", () => {
  test("invite accepted only by matching email", async () => {
    const { data: inv } = await b.client.from("invites").insert({ org_id: b.orgId, email: `c-${run}@test.dev`, role: "editor" }).select().single();
    const wrong = await a.client.rpc("accept_invite", { invite_token: inv!.token });
    expect(wrong.error?.message).toMatch(/different email/);
    const c = await makeUser(`c-${run}@test.dev`);
    const right = await c.client.rpc("accept_invite", { invite_token: inv!.token });
    expect(right.data).toBe(b.orgId);
    const { data: p } = await c.client.from("projects").select("id").eq("id", projectB);
    expect(p).toHaveLength(1);
  });
});
