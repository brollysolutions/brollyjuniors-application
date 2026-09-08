/**
 * The contract the API serves. Roles, permissions and features are defined
 * once on the server (app/shared/access.py) and arrive in the bootstrap, so a
 * permission string cannot drift between the two sides.
 */

export type RoleKey = 'BROLLY_ADMIN' | 'TEACHER' | 'STUDENT'

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

export type NavItem = { key: string; label: string; icon: string; badge?: number }

export type Bootstrap = {
  user: {
    id: string
    fullName: string
    email: string
    avatarInitials: string
    mustChangePassword: boolean
  }
  role: RoleKey
  roles: RoleKey[]
  permissions: string[]
  features: string[]
  brand: Brand
  nav: NavItem[]
  /** One line stating what this login can reach. Shown on every screen. */
  boundary: string
}

export type Problem = {
  type: string
  title: string
  status: number
  code?: string
  detail?: string
  traceId?: string
}

/** Authored content is a validated block document — never raw HTML. */
export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; language: string; source: string }
  | { type: 'callout'; variant: 'tip' | 'warning'; text: string }
  | { type: 'image'; mediaId: string; alt: string; caption?: string }
  | { type: 'video'; mediaId: string; caption?: string }

export type TestResult = { name: string; passed: boolean; detail: string }

export type RunOutcome = {
  results: TestResult[]
  passed: number
  total: number
  solved?: boolean
}

export const ROLE_THEME: Record<RoleKey, { accent: string; accentSoft: string; label: string }> = {
  BROLLY_ADMIN: { accent: '#2B6CB0', accentSoft: '#E7EFF9', label: 'Brolly admin' },
  TEACHER: { accent: '#157D77', accentSoft: '#D8F2EE', label: 'Teacher' },
  STUDENT: { accent: '#96630A', accentSoft: '#FBEFD3', label: 'Student' },
}

export const FALLBACK_BRAND: Brand = {
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

/** Money is stored as integer minor units. Never floats. */
export function formatPrice(minor: number, brand: Brand = FALLBACK_BRAND): string {
  if (minor === 0) return 'Free'
  return `${brand.currencySymbol}${(minor / 100).toLocaleString('en-IN')}`
}
