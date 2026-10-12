import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { acceptInvite } from "./actions";

export default async function InvitePage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) {
    const next = encodeURIComponent(`/invite/${token}`);
    return <main className="p-12">Please <Link className="underline" href={`/login?next=${next}`}>sign in</Link> or <Link className="underline" href={`/signup?next=${next}`}>sign up</Link> with the invited email address to join.</main>;
  }
  return (
    <main className="p-12">
      <form action={acceptInvite.bind(null, token)}>
        <p className="mb-4">You are signed in as {user.email}.</p>
        <button className="rounded bg-black px-4 py-2 text-white">Join workspace</button>
      </form>
      {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    </main>
  );
}
