import Stripe from "stripe";

// Undefined (not thrown) when unset so the app still boots and every other
// feature works before you've set up Stripe — routes that need it check
// for null themselves and return a clear "billing isn't configured yet"
// error instead of crashing at import time.
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
