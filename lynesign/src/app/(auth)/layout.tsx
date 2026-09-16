import Link from "next/link";

/**
 * Shell for the unauthenticated auth routes (register, sign in). Plain semantic
 * markup with neutral Tailwind utilities for now; the design system tokens and
 * the shared `Heading` primitive arrive in Tasks 15 to 17.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">
            Welcome to <span className="text-blue-600">LyneSign</span>
          </h1>
        </header>
        <div className="rounded-md border border-slate-200 bg-white p-6 shadow-sm">
          {children}
        </div>
        <p className="mt-4 text-center text-sm text-slate-600">
          <Link href="/login" className="underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
