import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { syncSubscriptionFromStripe } from "@/lib/billing";

// Stripe calls this directly — not a logged-in browser, so this is
// deliberately not wrapped in withAuth(). Authenticity comes entirely from
// the signature check below, not from a session.
export async function POST(req: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: "Billing isn't configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      if (userId && session.subscription) {
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
        await syncSubscriptionFromStripe(stripeSubscription, userId);
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const stripeSubscription = event.data.object as Stripe.Subscription;
      await syncSubscriptionFromStripe(stripeSubscription);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoice.parent?.subscription_details?.subscription;
      if (subscriptionId) {
        const id = typeof subscriptionId === "string" ? subscriptionId : subscriptionId.id;
        const stripeSubscription = await stripe.subscriptions.retrieve(id);
        await syncSubscriptionFromStripe(stripeSubscription);
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
