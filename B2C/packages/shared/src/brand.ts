/**
 * Branding lives in one object, not scattered through a hundred components.
 *
 * Today it is a constant, because the platform is Brolly Juniors and nothing
 * else. The point of the indirection is that when B2B arrives, this becomes a
 * lookup — the components that read it do not change, because they already read
 * `brand.name` rather than writing "Brolly Juniors" inline.
 *
 * That is the whole of the B2B preparation on the branding side. No school
 * entity, no tenant column, no dead configuration — just no hard-coded strings.
 */

export type Brand = {
  name: string
  shortName: string
  logoText: string
  tagline: string
  primaryColor: string
  secondaryColor: string
  supportEmail: string
  supportPhone: string
  city: string
  legalName: string
  currency: string
  currencySymbol: string
}

export const BROLLY_JUNIORS: Brand = {
  name: 'Brolly Juniors',
  shortName: 'Brolly',
  logoText: 'BJ',
  tagline: 'Python and AI, taught properly.',
  primaryColor: '#FFC93C',
  secondaryColor: '#2B6CB0',
  supportEmail: 'hello@brollyjuniors.com',
  supportPhone: '+91 98••• •••••',
  city: 'Hyderabad, Telangana',
  legalName: 'Brolly Software Solutions',
  currency: 'INR',
  currencySymbol: '₹',
}

/**
 * Resolve the brand for a request.
 *
 * One implementation today. When B2B lands this takes a host or an org id and
 * returns that organisation's brand — and every caller already works.
 */
export function resolveBrand(_hint?: string): Brand {
  return BROLLY_JUNIORS
}

/** Money is stored as integer minor units. Never floats. */
export function formatPrice(minor: number, brand: Brand = BROLLY_JUNIORS): string {
  if (minor === 0) return 'Free'
  return `${brand.currencySymbol}${(minor / 100).toLocaleString('en-IN')}`
}
