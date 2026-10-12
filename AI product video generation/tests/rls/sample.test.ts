import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

test("new users get an approved sample project with 7 steps", async () => {
  const u = await makeUser(`sample-${Date.now()}@test.dev`);
  const { data } = await u.client.from("projects").select("id, name, status, approved_by, storyboards(steps)").eq("org_id", u.orgId);
  expect(data).toHaveLength(1);
  expect(data![0]).toMatchObject({ name: "Sample: 3-shelf bookshelf", status: "approved", approved_by: u.userId });
  const sb = Array.isArray(data![0].storyboards) ? data![0].storyboards[0] : data![0].storyboards;
  expect(sb.steps).toHaveLength(7);

  const { data: assets } = await admin().from("assets").select("storage_path").eq("project_id", data![0].id);
  expect(assets!.map((a) => a.storage_path)).toContain("sample:bookshelf.glb");
});
