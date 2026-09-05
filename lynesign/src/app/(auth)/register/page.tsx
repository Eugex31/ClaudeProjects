"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { signUp } from "@/app/(auth)/actions";
import { signUpSchema, type SignUpInput } from "@/lib/validation/auth";

export default function RegisterPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const fd = new FormData();
    fd.set("name", values.name);
    fd.set("email", values.email);
    fd.set("password", values.password);
    fd.set("organizationName", values.organizationName);

    const result = await signUp(fd);
    if (result?.error) {
      setFormError(result.error);
      toast.error(result.error);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Create your account</h2>
        <p className="mt-1 text-sm text-slate-600">
          Start your 14 day trial. No card required.
        </p>
      </div>

      {formError ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {formError}
        </p>
      ) : null}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-slate-900">
          Name
        </label>
        <input
          id="name"
          type="text"
          autoComplete="name"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          {...register("name")}
        />
        {errors.name ? (
          <p className="mt-1 text-sm text-red-700">{errors.name.message}</p>
        ) : null}
      </div>

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
          autoComplete="new-password"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          {...register("password")}
        />
        {errors.password ? (
          <p className="mt-1 text-sm text-red-700">{errors.password.message}</p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="organizationName"
          className="block text-sm font-medium text-slate-900"
        >
          Organization name
        </label>
        <input
          id="organizationName"
          type="text"
          autoComplete="organization"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          {...register("organizationName")}
        />
        {errors.organizationName ? (
          <p className="mt-1 text-sm text-red-700">{errors.organizationName.message}</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-md bg-blue-600 px-3 py-2 font-medium text-white disabled:opacity-60"
      >
        {isSubmitting ? "Creating your account" : "Create account"}
      </button>
    </form>
  );
}
