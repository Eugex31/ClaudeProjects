import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Deliberately a different shell from (dashboard)/layout.tsx — no
// sidebar/header, since the block-palette/canvas/toolbar editor needs the
// full viewport (same reasoning as (admin)'s own distinct shell, just here
// for "give the canvas room" rather than "make the context unmistakable").
export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return <div className="min-h-screen bg-muted/30">{children}</div>;
}
