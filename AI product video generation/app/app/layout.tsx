import Link from "next/link";
import { getCurrentOrg, listMyOrgs } from "@/lib/data/orgs";
import { OrgSwitcher } from "./OrgSwitcher";
import { signOut } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const orgs = await listMyOrgs();
  const current = await getCurrentOrg(orgs);
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-4 border-b px-6 py-3">
        <Link href="/app" className="font-semibold">StepReel</Link>
        <OrgSwitcher orgs={orgs} currentId={current.id} />
        <nav className="ml-auto flex gap-4 text-sm">
          <Link href="/app/settings">Settings</Link>
          <form action={signOut}><button>Sign out</button></form>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
