import { NextResponse } from "next/server";
import { withAuth } from "@/lib/apiHandler";
import { stripe } from "@/lib/stripe";
import { getEffectiveSubscription } from "@/lib/billing";

// Reads straight from Stripe rather than mirroring invoices into Postgres —
// Stripe stays the single source of truth, nothing to keep in sync.
export const GET = withAuth(async (_req, { userId }) => {
  if (!stripe) {
    return NextResponse.json({ invoices: [] });
  }

  const subscription = await getEffectiveSubscription(userId);
  if (!subscription.stripeCustomerId) {
    return NextResponse.json({ invoices: [] });
  }

  const invoices = await stripe.invoices.list({ customer: subscription.stripeCustomerId, limit: 24 });

  return NextResponse.json({
    invoices: invoices.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      amountPaidCents: inv.amount_paid,
      currency: inv.currency,
      created: inv.created,
      hostedInvoiceUrl: inv.hosted_invoice_url,
      invoicePdf: inv.invoice_pdf,
    })),
  });
});
