import { Mail } from "lucide-react";

// Placeholder contact address — swap in your real support email whenever
// you're ready, same "placeholder now, real value later" approach as the
// footer's social links.
const CONTACT_EMAIL = "hello@example.com";

export function ContactSection() {
  return (
    <section id="contact" className="mx-auto max-w-3xl px-4 py-20 text-center">
      <h2 className="text-3xl font-semibold tracking-tight">Get in touch</h2>
      <p className="mt-3 text-muted-foreground">
        Questions about a plan, a feature, or anything else — we&apos;d love to hear from you.
      </p>
      <a
        href={`mailto:${CONTACT_EMAIL}`}
        className="mt-6 inline-flex items-center gap-2 text-lg font-medium text-primary hover:underline"
      >
        <Mail className="size-5" />
        {CONTACT_EMAIL}
      </a>
    </section>
  );
}
