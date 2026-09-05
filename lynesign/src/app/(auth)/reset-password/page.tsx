"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { resetPassword } from "@/app/(auth)/actions";

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const email = params.get("email") ?? "";
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const linkMissing = token === "" || email === "";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    const fd = new FormData();
    fd.set("token", token);
    fd.set("email", email);
    fd.set("password", password);
    const result = await resetPassword(fd);
    setSubmitting(false);
    if (result?.error) setFormError(result.error);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Choose a new password</h2>
        <p className="mt-1 text-sm text-slate-600">
          Enter a new password of at least 12 characters.
        </p>
      </div>

      {linkMissing ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700"
        >
          That reset link is invalid or has expired. Request a new one from the
          forgot password page.
        </p>
      ) : null}

      {formError ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700"
        >
          {formError}
        </p>
      ) : null}

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-900">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
        />
      </div>

      <button
        type="submit"
        disabled={submitting || linkMissing}
        className="w-full rounded-md bg-blue-600 px-3 py-2 font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Saving" : "Save new password"}
      </button>

      <p className="text-sm text-slate-600">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
