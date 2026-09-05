/**
 * The access-control vocabulary, shared by the API and the web app so a
 * permission string can never drift between the two.
 *
 * Code checks PERMISSIONS, never role names. That is what lets a school define
 * its own role later without a single change to feature code.
 *
 * Effective authority is a conjunction:
 *   permission (from roles)  AND  feature enabled for the school
 *                            AND  resource-scope policy on the loaded row
 *                            AND  entitlement, for curriculum content
 */

export const FEATURES = {
  school_management: 'Schools, staff and student records',
  class_management: 'Classes, sections and enrolment',
  teacher_management: 'Teacher accounts and assignment',
  student_management: 'Student accounts and credential slips',
  textbook_access: 'Videos, materials and the reading library',
  practice_labs: 'Unlimited unmarked practice',
  graded_labs: 'The practical file',
  examinations: 'Scheduled exams, marking and release',
  reports: 'Class and school reporting',
  certificates: 'Certificates and badges',
  announcements: 'One-way class announcements',
  course_purchase: 'Buying a course directly (B2C)',
  content_hub: 'Authoring and publishing master curriculum',
  licensing: 'Seats, licences and renewal',
} as const

export type FeatureKey = keyof typeof FEATURES

/** Default flags for a new tenant. The ONLY place tenant_type is read. */
export const FEATURE_DEFAULTS: Record<'B2B' | 'B2C' | 'INTERNAL', Partial<Record<FeatureKey, boolean>>> = {
  B2B: {
    school_management: true, class_management: true, teacher_management: true,
    student_management: true, textbook_access: true, practice_labs: true,
    graded_labs: true, examinations: true, reports: true, certificates: true,
    announcements: true, course_purchase: false, content_hub: false, licensing: false,
  },
  B2C: {
    school_management: false, class_management: false, teacher_management: true,
    student_management: false, textbook_access: true, practice_labs: true,
    graded_labs: true, examinations: true, reports: false, certificates: true,
    announcements: true, course_purchase: true, content_hub: false, licensing: false,
  },
  INTERNAL: {
    school_management: true, class_management: true, teacher_management: true,
    student_management: true, textbook_access: true, practice_labs: true,
    graded_labs: true, examinations: true, reports: true, certificates: true,
    announcements: true, course_purchase: true, content_hub: true, licensing: true,
  },
}

type PermDef = { key: string; description: string; feature?: FeatureKey }

export const PERMISSIONS: PermDef[] = [
  // every signed-in person, whatever their role
  { key: 'me:read', description: 'Read your own account and shell' },

  // platform
  { key: 'tenant:read', description: 'View schools', feature: 'licensing' },
  { key: 'tenant:create', description: 'Create a school', feature: 'licensing' },
  { key: 'tenant:update', description: 'Edit a school record', feature: 'licensing' },
  { key: 'tenant:suspend', description: 'Suspend or archive a school', feature: 'licensing' },
  { key: 'licence:manage', description: 'Set seats, levels and expiry', feature: 'licensing' },
  { key: 'entitlement:manage', description: 'Grant or revoke course access', feature: 'licensing' },
  { key: 'content:read', description: 'Read master curriculum', feature: 'textbook_access' },
  { key: 'content:create', description: 'Author master curriculum', feature: 'content_hub' },
  { key: 'content:update', description: 'Edit master curriculum', feature: 'content_hub' },
  { key: 'content:publish', description: 'Publish a content release', feature: 'content_hub' },
  { key: 'sync:run', description: 'Pull from the Content Hub', feature: 'content_hub' },
  { key: 'report:read:platform', description: 'Reporting across all schools' },
  { key: 'audit:read:platform', description: 'Read the platform audit log' },

  // school administration
  { key: 'user:read', description: 'View staff and students', feature: 'school_management' },
  { key: 'user:create', description: 'Create logins', feature: 'school_management' },
  { key: 'user:update', description: 'Edit a login', feature: 'school_management' },
  { key: 'user:deactivate', description: 'Deactivate a login', feature: 'school_management' },
  { key: 'user:reset_password', description: 'Issue a temporary password', feature: 'school_management' },
  { key: 'user:import', description: 'Bulk-upload a student list', feature: 'student_management' },
  { key: 'role:assign', description: 'Grant a role', feature: 'school_management' },
  { key: 'school:update', description: 'Edit the school profile', feature: 'school_management' },
  { key: 'branding:manage', description: 'Change name, colours and welcome message', feature: 'school_management' },

  // academic structure
  { key: 'class:read', description: 'View classes', feature: 'class_management' },
  { key: 'class:create', description: 'Create a class', feature: 'class_management' },
  { key: 'class:update', description: 'Edit a class', feature: 'class_management' },
  { key: 'class:assign_teacher', description: 'Put a teacher on a class', feature: 'class_management' },
  { key: 'class:assign_student', description: 'Put a student in a class', feature: 'class_management' },
  { key: 'course:assign', description: 'Give a class a course', feature: 'class_management' },

  // teaching
  { key: 'assignment:read', description: 'View what has been assigned', feature: 'textbook_access' },
  { key: 'assignment:create', description: 'Assign material to a class', feature: 'textbook_access' },
  { key: 'material:create', description: 'Write your own material', feature: 'textbook_access' },
  { key: 'curriculum:plan', description: 'Order a term of teaching', feature: 'textbook_access' },
  { key: 'announcement:create', description: 'Post to a class', feature: 'announcements' },

  // labs
  { key: 'practice:attempt', description: 'Attempt a practice lab', feature: 'practice_labs' },
  { key: 'lab:submit', description: 'Submit a graded lab', feature: 'graded_labs' },
  { key: 'lab:read:class', description: 'See submissions for your classes', feature: 'graded_labs' },
  { key: 'lab:grade', description: 'Grade a submission', feature: 'graded_labs' },

  // exams
  { key: 'exam:read', description: 'View exams', feature: 'examinations' },
  { key: 'exam:schedule', description: 'Schedule an exam', feature: 'examinations' },
  { key: 'exam:sit', description: 'Sit an exam', feature: 'examinations' },
  { key: 'exam:mark', description: 'Mark written answers', feature: 'examinations' },
  { key: 'exam:release', description: 'Release results', feature: 'examinations' },

  // progress and reporting, scoped
  { key: 'progress:read:self', description: 'See your own progress' },
  { key: 'progress:read:class', description: 'See progress for your classes', feature: 'reports' },
  { key: 'progress:read:tenant', description: 'See progress across the school', feature: 'reports' },
  { key: 'report:read:class', description: 'Class reports', feature: 'reports' },
  { key: 'report:read:tenant', description: 'School reports', feature: 'reports' },
  { key: 'audit:read:tenant', description: 'Read this school’s audit log', feature: 'school_management' },
]

export const PERMISSION_KEYS = PERMISSIONS.map(p => p.key)

export type RoleKey = 'BROLLY_ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT'

export const ROLES: Record<RoleKey, { name: string; level: number; permissions: string[] }> = {
  BROLLY_ADMIN: {
    name: 'Brolly admin',
    level: 100,
    permissions: [
      'me:read',
      'tenant:read', 'tenant:create', 'tenant:update', 'tenant:suspend',
      'licence:manage', 'entitlement:manage',
      'content:read', 'content:create', 'content:update', 'content:publish', 'sync:run',
      'report:read:platform', 'audit:read:platform', 'user:read',
    ],
  },
  SCHOOL_ADMIN: {
    name: 'School admin',
    level: 60,
    permissions: [
      'me:read',
      'user:read', 'user:create', 'user:update', 'user:deactivate', 'user:reset_password',
      'user:import', 'role:assign', 'school:update', 'branding:manage',
      'class:read', 'class:create', 'class:update', 'class:assign_teacher', 'class:assign_student',
      'course:assign', 'assignment:read', 'exam:read', 'content:read',
      'progress:read:tenant', 'report:read:tenant', 'report:read:class', 'audit:read:tenant',
    ],
  },
  TEACHER: {
    name: 'Teacher',
    level: 40,
    permissions: [
      'me:read',
      'user:read', 'class:read', 'content:read',
      'assignment:read', 'assignment:create', 'material:create', 'curriculum:plan',
      'announcement:create',
      'lab:read:class', 'lab:grade',
      'exam:read', 'exam:schedule', 'exam:mark', 'exam:release',
      'progress:read:class', 'report:read:class',
    ],
  },
  STUDENT: {
    name: 'Student',
    level: 10,
    permissions: [
      'me:read',
      'content:read', 'assignment:read',
      'practice:attempt', 'lab:submit',
      'exam:read', 'exam:sit',
      'progress:read:self',
    ],
  },
}

/** Role accent colours, kept beside the roles so portals stay recognisable. */
export const ROLE_THEME: Record<RoleKey, { accent: string; accentSoft: string; label: string }> = {
  BROLLY_ADMIN: { accent: '#2B6CB0', accentSoft: '#E7EFF9', label: 'Brolly admin' },
  SCHOOL_ADMIN: { accent: '#725AB4', accentSoft: '#EFECFF', label: 'School admin' },
  TEACHER: { accent: '#157D77', accentSoft: '#D8F2EE', label: 'Teacher' },
  STUDENT: { accent: '#96630A', accentSoft: '#FBEFD3', label: 'Student' },
}

export const PERMISSION_FEATURE: Record<string, FeatureKey | undefined> =
  Object.fromEntries(PERMISSIONS.map(p => [p.key, p.feature]))
