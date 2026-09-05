import type { RoleKey } from './access.ts'

export type Bootstrap = {
  user: {
    id: string
    fullName: string
    email: string | null
    username: string | null
    mustChangePassword: boolean
  }
  tenant: {
    id: string
    name: string
    schoolCode: string
    area: string
    board: string
    type: 'B2B' | 'B2C' | 'INTERNAL'
    isPlatform: boolean
  }
  branding: {
    displayName: string
    shortName: string
    logoText: string
    primaryColor: string
    secondaryColor: string
    welcomeMessage: string
  }
  roles: RoleKey[]
  permissions: string[]
  features: string[]
  scope: 'tenant' | 'platform'
  /** What this login can see, in one line. Shown on every screen. */
  boundary: string
  nav: NavItem[]
}

export type NavItem = { key: string; label: string; icon: string; badge?: number }

export type Problem = {
  type: string
  title: string
  status: number
  detail?: string
  code?: string
}

/** A block document — the only shape authored content ever takes. */
export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; language: string; source: string }
  | { type: 'callout'; variant: 'tip' | 'warning'; text: string }
  | { type: 'image'; mediaId: string; alt: string; caption?: string }

export type TestResult = {
  name: string
  passed: boolean
  detail: string
}

export type RunOutcome = {
  stdout: string
  stderr: string
  results: TestResult[]
  passed: number
  total: number
}
