import Link from "next/link";
import { requireAdmin } from "@/lib/adminAuth";

// Deliberately a different shell from (dashboard)/layout.tsx (top bar, not a
// sidebar) — an admin here is just a User row like any other, so anyone
// who's both a paying customer and an admin needs it visually unmistakable
// which context they're in.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="flex h-14 items-center gap-6 px-6">
          <span className="text-sm font-semibold tracking-wide text-muted-foreground">ADMIN</span>
          <nav className="flex items-center gap-4 text-sm font-medium">
            <Link href="/admin" className="hover:underline">
              Overview
            </Link>
            <Link href="/admin/customers" className="hover:underline">
              Customers
            </Link>
          </nav>
          <Link href="/dashboard" className="ml-auto text-sm text-muted-foreground hover:underline">
            Back to app
          </Link>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
