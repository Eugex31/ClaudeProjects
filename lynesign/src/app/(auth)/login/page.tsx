"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInWithPassword } from "@/app/(auth)/actions";
import { signInSchema, type SignInInput } from "@/lib/validation/auth";

function LoginForm() {
  const params = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) });

  const notice =
    params.get("reset") === "1"
      ? "Your password has been changed. Sign in with your new password."
      : params.get("registered") === "1"
        ? "Your account is ready. Sign in to continue."
        : null;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const fd = new FormData();
    fd.set("email", values.email);
    fd.set("password", values.password);
    const result = await signInWithPassword(fd);
    if (result?.error) setFormError(result.error);
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Sign in</h2>
        <p className="mt-1 text-sm text-slate-600">
          Use the email and password for your account.
        </p>
      </div>

      {notice ? (
        <p
          role="status"
          className="rounded-md border border-green-200 bg-green-50 p-2 text-sm text-green-800"
        >
          {notice}
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
        <label htmlFor="email" className="block text-sm font-medium text-slate-900">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          {...register("email")}
        />
        {errors.email ? (
          <p className="mt-1 text-sm text-red-700">{errors.email.message}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-900">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          {...register("password")}
        />
        {errors.password ? (
          <p className="mt-1 text-sm text-red-700">{errors.password.message}</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-md bg-blue-600 px-3 py-2 font-medium text-white disabled:opacity-60"
      >
        {isSubmitting ? "Signing in" : "Sign in"}
      </button>

      <p className="text-sm text-slate-600">
        <Link href="/forgot-password" className="underline">
          Forgot your password
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
