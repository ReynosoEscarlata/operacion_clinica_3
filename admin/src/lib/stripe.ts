import { loadStripe, type Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

// Carga perezosa y memorizada: loadStripe no debe llamarse más de una vez.
export const getStripe = (): Promise<Stripe | null> => {
  if (!stripePromise) {
    const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      throw new Error('Falta configurar VITE_STRIPE_PUBLISHABLE_KEY en el .env del frontend');
    }
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
};
