import { Suspense } from "react";
import { AuthForm } from "../AuthForm";

export default function SignupPage() {
  return (
    <main>
      <Suspense><AuthForm mode="signup" /></Suspense>
    </main>
  );
}
