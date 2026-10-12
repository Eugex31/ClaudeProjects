import { beforeAll, expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, approveCurrent, localEnv, makeUser, psql } from "./helpers";

const run = Date.now();
let a: Awaited<ReturnType<typeof makeUser>>;
let b: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  a = await makeUser(`hard-a-${run}@test.dev`);
  b = await makeUser(`hard-b-${run}@test.dev`);
});

test("A cannot select org B's assets rows", async () => {
  const { data: bAssets } = await admin().from("assets").select("id").eq("org_id", b.orgId);
  expect(bAssets!.length).toBeGreaterThan(0); // the seeded sample model
  const { data } = await a.client.from("assets").select("id").eq("org_id", b.orgId);
  expect(data).toEqual([]);
});

test("adding or removing a model resets an approved project to draft", async () => {
  const { data: p } = await b.client.from("projects").insert({ org_id: b.orgId, name: "Model swap" }).select().single();
  await b.client.from("storyboards").insert({ project_id: p!.id, org_id: b.orgId, steps: [{ id: "s" }] });
  expect((await approveCurrent(b.client, p!.id)).error).toBeNull();
  const { data: asset, error } = await b.client.from("assets").insert({
    org_id: b.orgId, project_id: p!.id, kind: "model", storage_path: "sample:bookshelf.glb", filename: "bookshelf.glb",
  }).select("id").single();
  expect(error).toBeNull();
  const status = async () => (await admin().from("projects").select("status").eq("id", p!.id).single()).data!.status;
  expect(await status()).toBe("draft");

  expect((await approveCurrent(b.client, p!.id)).error).toBeNull();
  await b.client.from("assets").insert({ org_id: b.orgId, project_id: p!.id, kind: "export", storage_path: `${b.orgId}/${p!.id}/e-x.webm`, filename: "x.webm" });
  expect(await status()).toBe("approved"); // exports don't invalidate approval
  await b.client.from("assets").delete().eq("id", asset!.id);
  expect(await status()).toBe("draft");
});

test("accept_invite requires a confirmed email", async () => {
  const email = `hard-unconfirmed-${run}@test.dev`;
  const { data: inv } = await b.client.from("invites").insert({ org_id: b.orgId, email, role: "editor" }).select().single();
  const u = await makeUser(email); // signed in while confirmed; the session JWT stays valid
  psql(`update auth.users set email_confirmed_at = null where id = '${u.userId}'`);
  const { error } = await u.client.rpc("accept_invite", { invite_token: inv!.token });
  expect(error?.message).toMatch(/Confirm your email/);
  const { data: m } = await admin().from("memberships").select("user_id").eq("org_id", b.orgId).eq("user_id", u.userId);
  expect(m).toEqual([]);
});

test("org_members returns emails to members only", async () => {
  const { data: own } = await b.client.rpc("org_members", { target_org: b.orgId });
  expect(own).toEqual([{ user_id: b.userId, email: `hard-b-${run}@test.dev`, role: "owner" }]);
  const { data: other, error } = await a.client.rpc("org_members", { target_org: b.orgId });
  expect(error).toBeNull();
  expect(other).toEqual([]);
  const anon = createClient(localEnv().url, localEnv().anonKey, { auth: { persistSession: false } });
  expect((await anon.rpc("org_members", { target_org: b.orgId })).error).not.toBeNull();
});
