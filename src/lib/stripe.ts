import Stripe from 'stripe';

/** The account's wire API version, kept across SDK updates. */
const PINNED_STRIPE_API_VERSION: string = '2025-11-17.clover';

// Lazy initialization to avoid build-time errors
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      // Preserve the existing wire API version; an SDK update is not an API migration.
      // Stripe types only its latest version: https://github.com/stripe/stripe-node#using-old-api-versions-with-typescript
      // Widened through `string` rather than `@ts-expect-error`, so it type-checks whether or not the installed SDK's
      // latest version still equals the pinned one (a stale stripe 20.0.0 install types 2025-11-17.clover; the lockfile's 20.4.1 types a newer one, see de02aa2).
      apiVersion: PINNED_STRIPE_API_VERSION as Stripe.LatestApiVersion,
      typescript: true,
    });
  }
  return _stripe;
}

// For backward compatibility, export stripe getter
export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    return getStripe()[prop as keyof Stripe];
  },
});

// Map price IDs to tiers
export function getTierFromPriceId(priceId: string): 'pro' | 'max' | null {
  const proPrices = [
    process.env.STRIPE_PRICE_PRO_MONTHLY,
    process.env.STRIPE_PRICE_PRO_ANNUAL,
  ];
  const maxPrices = [
    process.env.STRIPE_PRICE_MAX_MONTHLY,
    process.env.STRIPE_PRICE_MAX_ANNUAL,
  ];

  if (proPrices.includes(priceId)) return 'pro';
  if (maxPrices.includes(priceId)) return 'max';
  return null;
}

// Get or create Stripe customer for a user
export async function getOrCreateCustomer(
  userId: string,
  email: string,
  existingCustomerId?: string | null
): Promise<string> {
  // If customer already exists, return their ID
  if (existingCustomerId) {
    return existingCustomerId;
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email,
    metadata: {
      firebaseUserId: userId,
    },
  });

  return customer.id;
}
