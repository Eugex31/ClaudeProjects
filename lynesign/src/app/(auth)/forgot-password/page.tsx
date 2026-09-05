"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { requestPasswordReset } from "@/app/(auth)/actions";

const SENT_MESSAGE = "If that email is registered, we sent a reset link.";

function ForgotPasswordForm() {
  const params = useSearchParams();
  const forced = params.get("forced") === "1";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const fd = new FormData();
    fd.set("email", email);
    await requestPasswordReset(fd);
    setSubmitting(false);
    setSent(true);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Reset your password</h2>
        <p className="mt-1 text-sm text-slate-600">
          Enter your email and we will send a link to choose a new password.
        </p>
      </div>

      {forced ? (
        <p
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800"
        >
          Your account needs a new password before you can sign in. Request a
          reset link to continue.
        </p>
      ) : null}

      {sent ? (
        <p
          role="status"
          className="rounded-md border border-green-200 bg-green-50 p-2 text-sm text-green-800"
        >
          {SENT_MESSAGE}
        </p>
      ) : null}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-900">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-blue-600 px-3 py-2 font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Sending" : "Send reset link"}
      </button>

      <p className="text-sm text-slate-600">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
