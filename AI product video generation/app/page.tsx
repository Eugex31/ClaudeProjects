import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="text-4xl font-semibold">Turn your 3D model and manual into an accurate assembly video</h1>
      <p className="mt-4 text-gray-600">StepReel animates your real product geometry step by step, with narration in English, Portuguese, Spanish or French. You approve every video before it goes out.</p>
      <div className="mt-8 flex justify-center gap-4">
        <Link href="/signup" className="rounded bg-black px-4 py-2 text-white">Start a pilot</Link>
        <Link href="/login" className="rounded border px-4 py-2">Sign in</Link>
      </div>
    </main>
  );
}
