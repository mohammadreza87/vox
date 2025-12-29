import Stripe from 'stripe';

// Lazy initialization to avoid build-time errors
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16',
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
