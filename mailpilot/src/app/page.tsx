import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { HeroCarousel } from "@/components/marketing/hero-carousel";
import { ProductsSection } from "@/components/marketing/products-section";
import { PricingSection } from "@/components/marketing/pricing-section";
import { FaqSection } from "@/components/marketing/faq-section";
import { ContactSection } from "@/components/marketing/contact-section";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export default async function RootPage() {
  const session = await auth();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main className="flex-1">
        <section className="mx-auto flex max-w-6xl flex-col items-center gap-10 px-4 pt-16 pb-8 text-center">
          <div className="flex flex-col gap-4">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Cold email that actually gets sent
            </h1>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              Automation sequences, templates, segmentation, and reporting — all sending through your own
              Gmail account, not a shared domain your recipients don&apos;t recognize.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild size="lg">
              <Link href="/register">Sign Up Free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/login">Log In</Link>
            </Button>
          </div>
          <HeroCarousel />
        </section>

        <ProductsSection />
        <PricingSection />
        <FaqSection />
        <ContactSection />
      </main>

      <MarketingFooter />
    </div>
  );
}
