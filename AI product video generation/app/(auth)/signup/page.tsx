import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "../AuthForm";

export default function SignupPage() {
  return (
    <main>
      <Suspense><AuthForm mode="signup" /></Suspense>
      <p className="mt-4 text-center text-sm">Already have an account? <Link className="underline" href="/login">Sign in</Link></p>
    </main>
  );
}
