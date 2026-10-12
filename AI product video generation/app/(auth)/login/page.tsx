import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "../AuthForm";

export default function LoginPage() {
  return (
    <main>
      <Suspense><AuthForm mode="login" /></Suspense>
      <p className="mt-4 text-center text-sm">No account? <Link className="underline" href="/signup">Sign up</Link></p>
    </main>
  );
}
