"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/app";
  const supabase = createBrowserSupabase();
  const getRedirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } =
      mode === "signup"
        ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: getRedirectTo() } })
        : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMessage(error.message);
    if (mode === "signup") {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return setMessage("Check your email to confirm your account.");
    }
    router.push(next);
    router.refresh();
  }

  async function magicLink() {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: getRedirectTo() } });
    setMessage(error ? error.message : "Magic link sent. Check your email.");
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-24 flex max-w-sm flex-col gap-3">
      <h1 className="text-2xl font-semibold">{mode === "signup" ? "Create your StepReel account" : "Sign in to StepReel"}</h1>
      <input className="rounded border p-2" type="email" required placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="rounded border p-2" type="password" required minLength={8} placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button disabled={busy} className="rounded bg-black p-2 text-white disabled:opacity-50">{mode === "signup" ? "Sign up" : "Sign in"}</button>
      {mode === "login" && (
        <button type="button" onClick={magicLink} disabled={!email} className="text-sm underline disabled:opacity-50">Email me a magic link instead</button>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
    </form>
  );
}
