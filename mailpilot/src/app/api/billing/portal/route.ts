import { NextResponse } from "next/server";
import { withAuth } from "@/lib/apiHandler";
import { stripe } from "@/lib/stripe";
import { getEffectiveSubscription } from "@/lib/billing";

export const POST = withAuth(async (req, { userId }) => {
  if (!stripe) {
    return NextResponse.json({ error: "Billing isn't configured yet" }, { status: 503 });
  }

  const subscription = await getEffectiveSubscription(userId);
  if (!subscription.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account yet — subscribe to a paid plan first" }, { status: 400 });
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? req.nextUrl.origin;
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${baseUrl}/billing`,
  });

  return NextResponse.json({ url: session.url });
});
