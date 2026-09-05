import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/adminAuth";
import { stripe } from "@/lib/stripe";
import { getEffectiveSubscription } from "@/lib/billing";

// Admin-scoped mirror of GET /api/billing/invoices — same "read straight from
// Stripe, never mirror invoices into Postgres" choice, just for an arbitrary
// customer instead of the logged-in one.
export const GET = withAdminAuth<{ id: string }>(async (_req, { params }) => {
  if (!stripe) {
    return NextResponse.json({ invoices: [], paymentMethodStatus: "unknown" });
  }

  const subscription = await getEffectiveSubscription(params.id);
  if (!subscription.stripeCustomerId) {
    return NextResponse.json({ invoices: [], paymentMethodStatus: "none" });
  }

  const [invoices, paymentMethods] = await Promise.all([
    stripe.invoices.list({ customer: subscription.stripeCustomerId, limit: 24 }),
    stripe.paymentMethods.list({ customer: subscription.stripeCustomerId, type: "card" }),
  ]);

  const now = new Date();
  const card = paymentMethods.data[0]?.card;
  let paymentMethodStatus: "valid" | "expired" | "none" = "none";
  if (card) {
    const expiry = new Date(card.exp_year, card.exp_month, 0, 23, 59, 59);
    paymentMethodStatus = expiry < now ? "expired" : "valid";
  }

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
    paymentMethodStatus,
    cardBrand: card?.brand ?? null,
    cardLast4: card?.last4 ?? null,
  });
});
