import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { stripe } from "@/lib/stripe";
import { getEffectiveSubscription } from "@/lib/billing";
import { checkoutSchema } from "@/lib/validation/billing.schema";

export const POST = withAuth(async (req, { userId }) => {
  if (!stripe) {
    return NextResponse.json({ error: "Billing isn't configured yet" }, { status: 503 });
  }

  const { planKey } = checkoutSchema.parse(await req.json());
  const plan = await prisma.plan.findUnique({ where: { key: planKey } });
  if (!plan?.stripePriceId) {
    return NextResponse.json({ error: "This plan isn't available for checkout yet" }, { status: 503 });
  }

  const [user, existing] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }),
    getEffectiveSubscription(userId),
  ]);

  const baseUrl = process.env.NEXTAUTH_URL ?? req.nextUrl.origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    client_reference_id: userId,
    customer: existing.stripeCustomerId ?? undefined,
    customer_email: existing.stripeCustomerId ? undefined : user.email,
    success_url: `${baseUrl}/billing?checkout=success`,
    cancel_url: `${baseUrl}/billing?checkout=canceled`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
});
