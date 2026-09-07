import type { RoleKey } from './access.ts'
import type { Brand } from './brand.ts'

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

export type NavItem = { key: string; label: string; icon: string; badge?: number }

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

export type CourseCard = {
  id: string
  slug: string
  title: string
  subtitle: string
  level: string
  subject: string
  priceMinor: number
  durationHours: number
  lessons: number
  teachers: string[]
  enrolled?: boolean
}
