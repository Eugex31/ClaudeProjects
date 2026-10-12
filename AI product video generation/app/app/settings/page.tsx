import { getCurrentOrg } from "@/lib/data/orgs";
import { createClient } from "@/lib/supabase/server";
import { currentPeriod } from "@/lib/quota";
import { changeRole, createInvite, removeMember, renameOrg } from "./actions";

export default async function SettingsPage() {
  const org = await getCurrentOrg();
  const supabase = await createClient();
  const isOwner = org.role === "owner";
  const [{ data: members }, { data: invites }, { data: usage }] = await Promise.all([
    supabase.from("memberships").select("user_id, role").eq("org_id", org.id),
    isOwner ? supabase.from("invites").select("token, email, role, expires_at, accepted_at").eq("org_id", org.id)
            : Promise.resolve({ data: [] as any[] }),
    supabase.from("usage").select("generations").eq("org_id", org.id).eq("period", currentPeriod()).maybeSingle(),
  ]);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return (
    <div className="max-w-2xl space-y-8">
      <section>
        <h2 className="mb-2 font-semibold">Workspace</h2>
        <form action={renameOrg} className="flex gap-2">
          <input name="name" defaultValue={org.name} disabled={!isOwner} className="flex-1 rounded border p-2" />
          {isOwner && <button className="rounded border px-3">Rename</button>}
        </form>
        <p className="mt-2 text-sm text-gray-600">
          Plan: {org.plan} · AI generations this month: {usage?.generations ?? 0} / {org.monthly_generation_quota}
        </p>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Members</h2>
        <ul className="divide-y rounded border">
          {members?.map((m) => (
            <li key={m.user_id} className="flex items-center gap-2 p-2 text-sm">
              <code>{m.user_id.slice(0, 8)}</code>
              {isOwner ? (
                <>
                  <form action={changeRole} className="ml-auto flex gap-1">
                    <input type="hidden" name="userId" value={m.user_id} />
                    <select name="role" defaultValue={m.role} className="rounded border">
                      <option>owner</option><option>editor</option><option>viewer</option>
                    </select>
                    <button className="underline">Save</button>
                  </form>
                  <form action={removeMember}>
                    <input type="hidden" name="userId" value={m.user_id} />
                    <button className="text-red-700 underline">Remove</button>
                  </form>
                </>
              ) : <span className="ml-auto">{m.role}</span>}
            </li>
          ))}
        </ul>
      </section>
      {isOwner && (
        <section>
          <h2 className="mb-2 font-semibold">Invite a teammate</h2>
          <form action={createInvite} className="flex gap-2">
            <input name="email" type="email" required placeholder="teammate@company.com" className="flex-1 rounded border p-2" />
            <select name="role" className="rounded border"><option>editor</option><option>viewer</option></select>
            <button className="rounded bg-black px-3 text-white">Create link</button>
          </form>
          <ul className="mt-3 space-y-1 text-sm">
            {invites?.filter((i) => !i.accepted_at).map((i) => (
              <li key={i.token}>{i.email} ({i.role}) — send them: <code className="break-all">{site}/invite/{i.token}</code></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
