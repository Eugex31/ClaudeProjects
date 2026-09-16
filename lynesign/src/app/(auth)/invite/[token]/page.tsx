"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { acceptInvite } from "@/app/(auth)/actions";

/**
 * Accept-invitation screen. Reads the opaque token from the route and submits it
 * with a name and password to `acceptInvite`. A returning user whose email
 * already has an account can leave the fields blank; the server ignores them.
 * On success the server action signs the user in and redirects, so this
 * component only ever renders the inline error path. Plain semantic markup with
 * neutral Tailwind utilities; the design system arrives in Task 15.
 */
export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("password", password);
    const result = await acceptInvite(token, fd);
    setSubmitting(false);
    if (result?.error) setFormError(result.error);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Accept your invitation
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Set a name and password to join. If you already have a LyneSign
          account for this email, you can leave these blank and continue.
        </p>
      </div>

      {formError ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700"
        >
          {formError}
        </p>
      ) : null}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-slate-900">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-slate-900"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
        />
        <p className="mt-1 text-sm text-slate-600">
          Use at least 12 characters.
        </p>
      </div>

      <button
        type="submit"
        disabled={submitting || token === ""}
        className="w-full rounded-md bg-blue-600 px-3 py-2 font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Joining" : "Join the organization"}
      </button>

      <p className="text-sm text-slate-600">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
