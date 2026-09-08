# Brolly Juniors — Product Requirements Document

**Version:** 2.0 (Stack-confirmed baseline)
**Date:** 2 September 2026
**Supersedes:** v1.0. The technology-stack contradiction recorded in v1.0 §20.5 has been resolved by the client brief: FastAPI + Next.js + React Native/Expo + AWS is confirmed.
**Owner:** Product (Brolly Software Solutions, Hyderabad)
**Audience:** Product · Engineering · QA · Design · Content · Leadership
**Status:** Baseline for build. Four items in §20.4 are open and gate the full build spec.

---

## 0. Document Control

### 0.1 Source of truth used to write this PRD

| Rank | Source | Applied to |
|---|---|---|
| 1 | Client master brief (business model, roles, tenancy, white-label, Content Hub, technology stack) | §1–§13A framing, stack decisions |
| 2 | Locked Brolly Juniors application architecture (multi-tenant shared schema, RLS, three services, three data zones, flavour pipeline) | §13, §14, §21, Appendix A–C |
| 3 | Existing curriculum and textbook assets (Python Explorer / AI Explorer series, CBSE mapping documents) | §10, §11, §13.4 |
| 4 | Public regulatory and platform sources, verified September 2026 (DPDP Rules 2025, Google Play policy, CBSE affiliation data) | §6, §13.3, §14.5, §19 |

Where a project document written earlier disagrees with the locked architecture, the locked architecture wins and the divergence is recorded in §20.5.

### 0.2 Evidence classification used throughout

Every material statement in this PRD is tagged:

- **[C] Confirmed** — supplied in the brief, present in the locked architecture, or verified against a primary public source.
- **[A] Assumption** — a reasonable working position taken so the build can proceed. Every [A] is restated in §20 with the decision needed to retire it.
- **[U] Unknown / risk** — not knowable today. Listed in §19 or §20.4.

### 0.3 Revision triggers

This document must be re-baselined when any of the following occur: the data-separation requirement from the pilot school is received in writing; CBSE publishes the 2027–28 compulsory Classes 9–10 AI syllabus; the Play Console account decision is made; or the B2B payer model is settled.

---

## 1. Executive Summary

Brolly Juniors is a CBSE-aligned coding and AI learning platform for Classes 5 to 9, built by Brolly Software Solutions. It is sold through two commercial models against one product: **B2C** direct to families under the Brolly brand, and **B2B** to schools as white-labelled textbooks, school-branded mobile apps, and supplied or trained teachers. [C]

The content exists and the platform does not. Ten finished textbook parts with a working HTML-to-PDF pipeline, CBSE-mapped and verified, are ready to be taught from. The software that delivers them — course delivery, practice, assessment, scheduling, teacher tooling, school administration and per-school mobile apps — is being built from scratch by a team of five developers and one content designer, against a compressed pilot with five Hyderabad schools. [C]

The single decision that shapes everything else is tenancy. Brolly Juniors is a **multi-tenant SaaS platform on a shared database with a shared schema**, where every tenant-owned row carries a non-nullable `tenant_id` and isolation is enforced in PostgreSQL by row-level security rather than by application code alone. B2C is Tenant #1 — not a separate product, not a separate codebase, and not a special case in the data model. An earlier clone-per-school design (one database and one deployment per school, with a sync client) was evaluated and reversed; that reversal is settled and this PRD does not reopen it. [C]

Three structural obligations follow, and each is a first-class requirement rather than a later hardening task:

1. **A global user with per-tenant memberships.** Brolly-supplied teachers serve several schools, so identity cannot be scoped to a tenant. One `User`, many `Membership` rows, each carrying the role held in that tenant. [C]
2. **Consent as a first-class model with a `fiduciary_role` flag.** Every learner on this platform is legally a child in India. The DPDP Rules 2025 were notified on 13 November 2025 with full compliance required by **13 May 2027**, they require verifiable parental consent before processing a child's personal data, and they prohibit tracking, behavioural monitoring and targeted advertising directed at children. Whether Brolly is the fiduciary (B2C) or the school is (B2B) changes the obligation, so the flag is on the record, not in the code path. [C]
3. **One codebase producing per-school mobile apps.** A single-flavour pipeline builds five signed AABs from one commit, each published as a separate Play Store app under the school's own name. Google's Repetitive Content policy and the Families policy both apply, and unlisted distribution is the recommended pilot posture. [C]

The platform is delivered as three services — **Brolly App** (the tenant-aware product), **Content Hub** (global, tenant-free curriculum), and **Code Execution** (graded Python submissions) — over three data zones: global content with no `tenant_id`, tenant-scoped organisational data, and person-scoped activity data. Practice code runs in the browser under Pyodide at zero marginal cost; only graded submissions reach the hosted runtime. [C]

The commercial model is per-student pricing in both channels. In B2B, whether the school or the parent pays is not yet decided, and that decision changes the billing entity, the invoicing surface and the consent chain. It is one of four open items in §20.4, and it is the one with the largest downstream blast radius on functional scope. [U]

The plan is five gated milestones to a pilot with five schools. The critical path is not code — it is the Play Console account, which has the longest external lead time of anything in the plan and must be started before any other mobile work. [C]

---

## 2. Vision Statement

**Every child in an Indian classroom should leave school able to build with a computer and able to question a machine that claims to know something — and the school they attend should not determine which of the two they get.**

Brolly Juniors exists to make a single, rigorously-built curriculum available identically to a family buying directly and to a school buying for a thousand students, without the school having to become a software company and without the family having to settle for a worse version of the same thing.

---

## 3. Mission Statement

To deliver CBSE-aligned coding and AI learning for Classes 5 to 9 on one multi-tenant platform that:

- teaches from content Brolly has already written, verified and mapped to the official CBSE curriculum;
- gives every school its own branded app, its own schedule and its own data boundary, from one codebase and one shared content library;
- lets a child write and run real Python in the browser, on a low-cost Android phone, without a server round-trip;
- treats every learner as a child in law, and every consent as a record rather than a checkbox;
- and never claims a syllabus alignment it cannot show in the official CBSE document.

---

## 4. Business Objectives

Objectives are stated with the measure that proves them. Where a target depends on an open input, the target is marked and cross-referenced.

| ID | Objective | Measure | Target | Basis |
|---|---|---|---|---|
| BO-1 | Run a successful pilot in five Hyderabad schools | Schools live with students completing scheduled chapters | 5 of 5 schools live in the pilot term | [C] pilot scope |
| BO-2 | Prove the tenancy model holds under real load | Cross-tenant data leakage incidents | Zero, verified by automated isolation tests on every build | [C] |
| BO-3 | Ship white-label apps without a per-school codebase | Engineering hours per additional school app | ≤ 1 developer-day per new school after the pipeline exists | [A] pipeline design |
| BO-4 | Convert pilot schools to paid renewal | Schools renewing at end of pilot term | ≥ 4 of 5 | [A] |
| BO-5 | Establish B2C as a self-serve revenue line | B2C paid learners active in Tenant #1 | Target pending year-two figures (§20.4 Q3) | [U] |
| BO-6 | Reach DPDP readiness ahead of enforcement | Consent, retention, erasure and audit controls operational | Complete before 13 May 2027 | [C] statutory |
| BO-7 | Keep unit economics viable at pilot scale | Infrastructure cost per active student per month | Ceiling to be set once year-two targets are known | [U] |
| BO-8 | Reuse the existing content investment | Textbook parts delivered as in-platform chapters | 100% of finished parts ingested to Content Hub before pilot start | [C] |

**Why these and not others.** BO-2 is listed as a business objective rather than an engineering one deliberately. One school has already asked for data separation in writing; a cross-tenant leak in a product serving 10-to-15-year-olds is not a bug report, it is the end of the B2B channel and a reportable personal-data breach with a 72-hour clock attached.

---

## 5. Problem Statement

### 5.1 The situation

CBSE's Computational Thinking & AI curriculum for Classes 3–8 rolls out from 2026–27, and the Ministry of Education has announced AI as a compulsory subject for Classes 9–10 from 2027–28. [C] Schools therefore have a mandate arriving on a fixed date, and most of them have neither a teacher who can teach Python nor a curriculum mapped to the official outcome lists.

### 5.2 The problems, by actor

**For a school.** The mandate is real, the timeline is short, and the three ways to meet it are all bad. Hire a specialist teacher (expensive, scarce, and unusable for one period a week). Buy a generic coding platform (not CBSE-mapped, priced per seat in dollars, and branded as somebody else's product in front of fee-paying parents). Do it in-house (no curriculum, no assessment instrument, no textbooks).

**For a school administrator specifically.** Any external platform means student data leaving the school. One of the five pilot schools has already made data separation an explicit condition. [C] Administrators also need to see who is actually using the thing, because they will be asked at the next parent meeting.

**For a teacher.** A teacher assigned to computer periods is usually not a programmer. They need the lesson prepared, the code examples already run and known to work, an answer key, and a way to see which twelve children in a class of forty are stuck — without marking forty Python files by hand.

**For a student.** Setting up Python on a school machine, or on a shared home Android phone, is the single largest drop-off point in learning to code. Anything requiring an install, an account per tool, or a working laptop excludes most of the target learner base.

**For a parent (B2C).** They cannot evaluate a coding course. What they can evaluate is whether it matches what the school will examine, whether their child is actually doing it, and whether the platform is safe for a 10-year-old.

### 5.3 Why existing options fail

| Option | Why it fails for this market |
|---|---|
| Global coding platforms | Not mapped to CBSE outcome lists; priced in USD; branded as a third party inside the school; no white-label; child-data posture built for COPPA, not DPDP |
| Indian tuition-style AI/coding classes | Live-teacher-bound, so unit economics collapse at school scale; no per-tenant scheduling; no textbook |
| Textbook publishers | Content only; no execution environment, no assessment, no visibility for the school |
| School-built solutions | No curriculum, no content pipeline, no maintenance capacity |

### 5.4 The gap Brolly Juniors fills

Brolly already has the hard part: verified, CBSE-mapped content for Classes 5–9 across two tracks. What is missing is the delivery layer that makes the same content simultaneously a school's branded app, a teacher's console, a student's practice environment, and a direct-to-parent product — without forking the content or the code.

---

## 6. Market Opportunity

This section is deliberately bottom-up. Top-down market sizing for Indian K-12 EdTech is dominated by aggregator estimates that vary by an order of magnitude, and none of them would change a decision in this PRD.

### 6.1 Confirmed demand drivers [C]

1. **A dated mandate.** CBSE's CT & AI curriculum for Classes 3–8 applies from 2026–27; AI becomes compulsory for Classes 9–10 from 2027–28. Schools must act, on a schedule they do not control.
2. **A large affiliated base.** CBSE's own affiliation page states that more than 24,000 schools are affiliated to the board for Secondary and Senior Secondary examination purposes (cbse.gov.in, checked 2 September 2026).
3. **An examined subject at the top of the ladder.** Class 9 AI (subject code 417) is a 100-mark skill subject with a defined Python practical file. That converts an enrichment purchase into an exam-preparation purchase, which is the highest-intent segment in Indian education.
4. **A compliance cliff that favours a prepared vendor.** The DPDP Rules 2025 were notified on 13 November 2025 with full compliance required by 13 May 2027, and Rule 10 mandates verifiable parental consent before processing a child's data. The Act classifies anyone under 18 as a child and requires age-verification plus fully auditable parental-consent workflows. Any competitor without a consent model in its schema has an expensive retrofit ahead of it; Brolly Juniors has `Consent` as a first-class model from day one.

### 6.2 Serviceable entry point [C/A]

The immediate serviceable market is Hyderabad CBSE private schools with Classes 5–9 and a computer period already timetabled. Five are in the pilot. [C] Expansion beyond that is a function of the year-two targets, which are not yet set. [U — §20.4 Q3]

### 6.3 The revenue model and what is undecided

Pricing is per student in both channels. [C] In B2B, the payer is undecided. [U — §20.4 Q4] The two options are materially different products:

| Model | Billing entity | Consent chain | Functional impact |
|---|---|---|---|
| **School pays** | One invoice per tenant, per term, on seat count | School is likely the data fiduciary; Brolly is processor | No in-app payment surface for B2B; needs seat reconciliation, PO/invoice workflow, GST handling per school |
| **Parent pays (school-mediated)** | Per-parent transaction inside a school tenant | Brolly is fiduciary for the payment relationship even inside a school tenant | Needs a payment surface inside a white-labelled school app, which collides with Play billing policy and with the school's branding |

**Recommendation:** school-pays for the pilot, with parent-pays deferred. The parent-pays variant puts a purchase flow inside a school-branded child-directed app, which is the single hardest thing to get through Play review and the thing most likely to delay five app listings at once. If parent-pays is commercially required later, run it on the web checkout under the Brolly brand and keep the school apps consumption-only.

### 6.4 Competitive posture

Brolly's defensible position is not the platform; platforms are copyable. It is the pairing of (a) content that is already written and verified against the official CBSE PDFs, and (b) a white-label delivery model that lets a school present the programme as its own. The honest limitation: the CBSE 3–8 curriculum is concept- and no-code-focused and does not mandate Python. Marketing must never claim Python is examined below Class 9. That constraint is a product requirement, not just a marketing guideline — see FR-CH-08.

---

## 7. Stakeholders

### 7.1 Internal

| Stakeholder | Interest | Decision rights |
|---|---|---|
| Founder / Leadership | Pilot conversion, unit economics, channel strategy | Pricing, payer model, school selection, go/no-go at each gate |
| Product | Scope, sequencing, requirement quality | Backlog priority, acceptance of gate exit criteria |
| Engineering (5 developers) | Deliverability within pilot timeline | Technical design within the locked architecture |
| Content Designer (1) | Curriculum fidelity, chapter ingestion | Content correctness, CBSE mapping claims |
| QA | Isolation, correctness, release confidence | Release veto on failed isolation or accessibility gates |
| Support / Ops | Onboarding load per school | Runbook sign-off before each school goes live |

**Capacity note [C]:** five developers and one content designer. Three services, five mobile app flavours, four role-based interfaces and a compressed pilot exceed that capacity if all are built to full depth simultaneously. §12 and §22 are written to protect the team from that, and every gate in §22.2 has an explicit "not in this gate" list.

### 7.2 External

| Stakeholder | Interest | Where they appear in requirements |
|---|---|---|
| School management | Brand, safety, visible outcomes, data control | FR-BRD, FR-SAD, FR-RPT |
| School Admin (named individual per school) | Roster accuracy, scheduling, reporting | FR-SAD, FR-ENT |
| School computer teachers | Prepared lessons, low marking load | FR-TCH |
| Brolly-supplied teachers | Working across multiple schools in one login | FR-IAM-04 |
| Parents / guardians | Consent, child safety, progress visibility | FR-CON, FR-RPT-06 |
| Students (10–15) | Working code, fast feedback, no setup | FR-LRN, FR-CODE |
| Google Play | Policy compliance for child-directed apps | FR-MOB, NFR-CMP |
| CBSE (indirect) | Curriculum accuracy claims | FR-CH-08 |
| Data Protection Board of India | DPDP compliance | FR-CON, NFR-PRV |

---

## 8. User Personas

### P1 — Brolly Admin ("Ravi", platform operations)

Works for Brolly. Provisions tenants, ingests content, resolves incidents across all schools. Needs cross-school visibility to run the business and must not have casual access to individual children's work.

- **Goals:** onboard a school in under a day; see platform-wide adoption; diagnose a school's problem without asking them to screenshot it.
- **Frustrations:** support requests that require guessing at a school's configuration.
- **Non-negotiable behaviour:** cross-school views read from nightly rollups, never live student records — for privacy and for query cost. Any access to an individual student's record happens through **audited impersonation**, with a reason recorded, a time limit, and a visible banner. Brolly Admin is a platform flag, not a seeded user inside each tenant. [C]

### P2 — School Admin ("Mrs. Lakshmi", a pilot school)

Vice-principal or academic coordinator. Not technical. Owns the roster, the timetable and the answer she gives at the parent meeting.

- **Goals:** get 400 students into the right classes without typing them individually; set which chapter each section is on; show usage to the principal.
- **Frustrations:** any workflow that requires her to understand tenancy, or to re-enter data that already exists in the school ERP.
- **Key constraint:** her school asked for data separation. She will ask what that means in practice and must get a straight answer. [C]

### P3 — School Teacher ("Mr. Anil", school-employed)

Teaches computer periods across several sections. Competent with computers, not a Python programmer.

- **Goals:** open today's lesson and teach it; see who is stuck; mark quickly.
- **Frustrations:** code examples that do not run; having to invent practice questions.
- **Key need:** the answer key and the expected output must already exist for every exercise, because he cannot debug a child's Python live in front of thirty-nine others.

### P4 — Brolly Teacher ("Sneha", supplied by Brolly to schools)

Employed by Brolly, teaches at three schools on different days.

- **Goals:** one login, three schools, no confusion about which class she is looking at.
- **Frustrations:** having to remember which account belongs to which school.
- **This persona is the reason identity is global and membership is per-tenant.** [C] She is also the reason every screen must show the active tenant unambiguously — a teacher marking the wrong school's class is a data-integrity incident, not a UX annoyance.

### P5 — Student, Classes 5–6 ("Aarav", age 10–11)

- **Goals:** make something appear on the screen; collect the badge; not get stuck.
- **Frustrations:** installs, logins, error messages he cannot read.
- **Constraints:** may be on a shared low-cost Android device; may have intermittent connectivity; reading level is the binding constraint on every string in the UI.

### P6 — Student, Classes 7–9 ("Divya", age 13–15)

- **Goals:** finish the practical file; pass the practical exam and viva; build something she can show.
- **Frustrations:** practice that does not resemble the examined format.
- **Constraint:** for Class 9, her work must map to the official 417 practical file structure, because that is what is marked.

### P7 — Parent / Guardian ("Mr. Prasad", B2C buyer)

- **Goals:** know it matches what school will examine; see that his daughter is actually using it; pay once and be done.
- **Frustrations:** subscriptions he cannot see or cancel; anything that looks like it is tracking his child.
- **Legal position:** he is the consent-giver. Under DPDP Rule 10 his consent must be verifiable and auditable, and no behavioural tracking or targeted advertising may be directed at his child. [C]

---

## 9. User Roles & Permissions

### 9.1 Role model

Roles are held through `Membership`, which binds a global `User` to a `Tenant` with a role. A user may hold different roles in different tenants. Brolly Admin is **not** a membership — it is a platform-level flag on the user, checked outside tenant scope. [C]

| Role | Scope | Held via | Present in |
|---|---|---|---|
| Brolly Admin | Platform | User flag + audited impersonation | Both channels |
| School Admin | One tenant | Membership | B2B only |
| Teacher | One or more tenants | One Membership per tenant | Both channels |
| Student | One tenant | Membership | Both channels |
| Guardian | One tenant, linked to one or more Students | Membership + `GuardianLink` | B2C required; B2B optional [A] |

**Guardian is added to the brief's role list, deliberately.** The brief lists Brolly Admin / Teacher / Student for B2C. A B2C product whose users are all under 18 cannot have the child as the account holder under DPDP Rule 10 — the parent must be the account holder and consent-giver. Guardian is therefore a required role in B2C. In B2B the school holds the relationship, and whether guardians get accounts at all is an open scoping question tied to the payer decision (§20.4 Q4). [A]

### 9.2 Permission matrix

`✔` = permitted · `◐` = permitted, own scope only · `⊘` = denied · `🔍` = permitted only via audited impersonation

| Capability | Brolly Admin | School Admin | Teacher | Student | Guardian |
|---|---|---|---|---|---|
| Create / suspend tenant | ✔ | ⊘ | ⊘ | ⊘ | ⊘ |
| Configure tenant branding | ✔ | ✔ | ⊘ | ⊘ | ⊘ |
| Import / manage roster | ✔ | ✔ | ⊘ | ⊘ | ⊘ |
| Create classes & sections | ✔ | ✔ | ⊘ | ⊘ | ⊘ |
| Assign teacher to class | ✔ | ✔ | ⊘ | ⊘ | ⊘ |
| Set chapter schedule for a class | ✔ | ✔ | ◐ (own classes, if delegated) | ⊘ | ⊘ |
| Author / edit global content | ✔ | ⊘ | ⊘ | ⊘ | ⊘ |
| Publish content version | ✔ | ⊘ | ⊘ | ⊘ | ⊘ |
| Grant tenant entitlement to a course | ✔ | ⊘ | ⊘ | ⊘ | ⊘ |
| View a chapter's teaching notes | ✔ | ✔ | ✔ | ⊘ | ⊘ |
| View answer keys | ✔ | ⊘ | ✔ | ⊘ | ⊘ |
| View own class roster | ✔ | ✔ | ◐ | ⊘ | ⊘ |
| View an individual student's submissions | 🔍 | ◐ (own tenant) | ◐ (own classes) | ◐ (self) | ◐ (linked child) |
| Run practice code | ✔ | ✔ | ✔ | ✔ | ⊘ |
| Submit graded work | ⊘ | ⊘ | ⊘ | ✔ | ⊘ |
| Grade / override a score | 🔍 | ⊘ | ◐ (own classes) | ⊘ | ⊘ |
| View tenant-level analytics | ✔ | ✔ | ⊘ | ⊘ | ⊘ |
| View cross-tenant analytics | ✔ (rollups only) | ⊘ | ⊘ | ⊘ | ⊘ |
| Manage consent records | ✔ (view/audit) | ◐ (own tenant) | ⊘ | ⊘ | ◐ (own grants) |
| Export tenant data | ✔ | ✔ | ⊘ | ⊘ | ⊘ |
| Request erasure | ✔ (execute) | ✔ (raise) | ⊘ | ◐ (raise) | ✔ (raise for child) |
| Read audit log | ✔ | ◐ (own tenant) | ⊘ | ⊘ | ⊘ |

### 9.3 Rules that the matrix does not capture

- **PERM-01** — No role, including Brolly Admin, may read a tenant-scoped row without a tenant context set on the database session. Denial is enforced by RLS, not by view logic. [C]
- **PERM-02** — Brolly Admin's default state is *no* access to person-scoped data. Access is obtained per session through impersonation with a mandatory reason, expires automatically, and writes an audit record on entry and exit. [C]
- **PERM-03** — A Teacher's scope is the set of classes assigned to them **within the active tenant**. Holding a Teacher membership in tenant A grants nothing in tenant B.
- **PERM-04** — School Admin may not view answer keys. This is deliberate: answer keys are teaching material and a leaked key devalues every assessment in the tenant.
- **PERM-05** — Guardian access is read-only over the linked child's progress, and never over another child's data, including class leaderboards that name other children.
- **PERM-06** — Role changes take effect on the next request, not the next login. A revoked teacher must lose access immediately.

---

## 10. Product Scope

### 10.1 What Brolly Juniors is

A multi-tenant learning platform for Classes 5 to 9, delivering two curriculum tracks (Python and AI) from one global content library, to four role-based interfaces, through a web application and per-tenant mobile apps.

### 10.2 The three services [C]

| Service | Responsibility | Tenant-aware? |
|---|---|---|
| **Brolly App** | All tenant-scoped behaviour: identity, membership, entitlement, scheduling, learning delivery, assessment, teacher and admin consoles, reporting, consent | Yes — every query runs under a tenant context |
| **Content Hub** | Authoring, versioning and publishing of global curriculum: courses, chapters, lessons, exercises, answer keys, assets | No — content carries no `tenant_id` |
| **Code Execution** | Sandboxed execution of graded Python submissions | Tenant-tagged for quota and audit; stateless otherwise |

### 10.3 The three data zones [C]

| Zone | Contains | `tenant_id` | Retention posture |
|---|---|---|---|
| **Global content** | Course, Chapter, Lesson, Exercise, AnswerKey, Asset, ContentVersion | **No** | Indefinite; versioned |
| **Tenant-scoped organisational** | Tenant, Membership, Class, Section, Entitlement, Schedule, Branding, Invite | **Yes, NOT NULL** | Life of contract + statutory minimum |
| **Person-scoped activity** | Submission, Attempt, Progress, Score, Streak, ConsentRecord, AuditEvent | **Yes, NOT NULL** | Shortest defensible period; erasable on request |

**Why content carries no `tenant_id`.** A chapter on `for` loops is the same chapter for every school. Copying it per tenant would multiply the content by the number of schools, make a correction a fan-out job, and break the entire economics of the white-label model. Tenancy attaches to *entitlement* (which tenant may see this course) and *schedule* (when this class reaches this chapter), never to the content itself. [C]

### 10.4 Deployment topology [C]

Two deployment classes, not five. One **shared deployment** serves Tenant #1 (B2C) and all standard school tenants. One **conditionally isolated deployment** exists for a tenant whose contract requires physical separation — currently one pilot school has asked for data separation, and the exact wording of that requirement is outstanding (§20.4 Q2). Both classes run identical code from the same commit; they differ only in database and infrastructure boundary.

**Why not five deployments:** five deployments means five migration runs, five monitoring surfaces, five incident procedures and five places for configuration to drift, against a team of five developers. The shared-schema-plus-RLS model gives the isolation guarantee that matters at a fraction of the operational cost, and the isolated class exists as a contractual escape hatch rather than the default.

### 10.5 Channel scope

| | B2C (Tenant #1) | B2B (one tenant per school) |
|---|---|---|
| Branding | Brolly | School's own |
| Mobile app | Brolly Juniors app | Per-school app, separate listing |
| Roles present | Brolly Admin, Teacher, Student, Guardian | Brolly Admin, School Admin, Teacher, Student, (Guardian TBD) |
| Who schedules content | Brolly / self-paced | School Admin per class |
| Who pays | Parent | Undecided (§20.4 Q4) |
| Fiduciary role on consent | Brolly | School (subject to legal confirmation) |

### 10.6 Curriculum scope [C/U]

Classes 5–9, two tracks (Python, AI), mapped to the CBSE CT & AI curriculum for Classes 5–8 and to AI 417 for Class 9.

**Content inventory requires confirmation before Gate 1.** Two internal records disagree: one states ten finished textbook parts with the AI track covering Classes 6–7 across four completed parts; another records both series as complete across Classes 5–9. The ingestion plan, the pilot's class coverage and the Content Hub seeding effort all depend on which is correct. This is raised as §20.4 Q5. [U]

---

## 11. In-Scope Features

Grouped by epic, with the release gate each is targeted at (see §22.2). "P0" means the pilot cannot start without it.

### E1 — Tenancy & Isolation
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E1.1 | Tenant provisioning and lifecycle (create, activate, suspend, archive) | P0 | G1 |
| E1.2 | `tenant_id` on every tenant-owned table, non-nullable | P0 | G1 |
| E1.3 | PostgreSQL RLS with `FORCE ROW LEVEL SECURITY` on a dedicated non-superuser role | P0 | G1 |
| E1.4 | Request-scoped tenant context middleware | P0 | G1 |
| E1.5 | `TenantTask` Celery base class carrying tenant context into background work | P0 | G1 |
| E1.6 | Conditionally isolated deployment class | P0 | G2 |
| E1.7 | Automated cross-tenant isolation test suite in CI | P0 | G1 |

### E2 — Identity, Membership & Access
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E2.1 | Global `User` with email/phone identity | P0 | G1 |
| E2.2 | Per-tenant `Membership` with role | P0 | G1 |
| E2.3 | Tenant switcher for multi-tenant users | P0 | G2 |
| E2.4 | Student login without email (roster code + PIN) | P0 | G2 |
| E2.5 | Guardian account and `GuardianLink` | P0 (B2C) | G3 |
| E2.6 | Brolly Admin platform flag | P0 | G1 |
| E2.7 | Audited impersonation with reason, TTL and banner | P0 | G2 |
| E2.8 | Password reset, session management, forced logout on role revocation | P0 | G2 |

### E3 — Consent & Child Data
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E3.1 | `Consent` model with `fiduciary_role`, purpose, version, timestamp, evidence | P0 | G2 |
| E3.2 | Append-only consent history (never updated in place) | P0 | G2 |
| E3.3 | Consent gating: no person-scoped processing before a valid grant | P0 | G3 |
| E3.4 | Consent withdrawal and downstream effect | P0 | G3 |
| E3.5 | Data export and erasure workflow | P1 | G4 |
| E3.6 | Verifiable parental consent verification path | P1 | G4 |

### E4 — Content Hub
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E4.1 | Course → Chapter → Lesson → Block content model | P0 | G1 |
| E4.2 | Exercise and AnswerKey models with expected output | P0 | G1 |
| E4.3 | Content versioning with immutable published versions | P0 | G2 |
| E4.4 | Ingestion of existing textbook HTML into chapter blocks | P0 | G1 |
| E4.5 | Asset store (images, SVG, downloadable PDFs) | P0 | G1 |
| E4.6 | CBSE mapping metadata per chapter, with a CBSE / BOOST flag | P0 | G2 |
| E4.7 | Preview-as-role for authors | P1 | G3 |

### E5 — Entitlement & Scheduling
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E5.1 | Tenant-level course entitlement | P0 | G2 |
| E5.2 | Class and Section model | P0 | G2 |
| E5.3 | Per-class chapter schedule over shared global content | P0 | G2 |
| E5.4 | Roster import (CSV) with validation and dry-run | P0 | G2 |
| E5.5 | Teacher-to-class assignment | P0 | G2 |
| E5.6 | Self-paced track for B2C | P1 | G3 |

### E6 — Learning Experience (Student)
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E6.1 | Chapter reader rendering ingested content blocks | P0 | G2 |
| E6.2 | In-browser Python editor (CodeMirror 6) with run | P0 | G2 |
| E6.3 | Pyodide practice runtime, no server round-trip | P0 | G2 |
| E6.4 | Graded submission to hosted Code Execution service | P0 | G3 |
| E6.5 | Auto-check against expected output with feedback | P0 | G3 |
| E6.6 | XP, badges and streak mechanics carried over from the textbooks | P1 | G3 |
| E6.7 | Progress state per student per chapter | P0 | G2 |
| E6.8 | Offline-tolerant reading with queued submission | P2 | G5 |

### E7 — Assessment
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E7.1 | Quiz engine (MCQ, short answer, code output prediction) | P0 | G3 |
| E7.2 | Auto-grading with deterministic re-run | P0 | G3 |
| E7.3 | Teacher manual override with reason | P0 | G3 |
| E7.4 | Class 9 practical-file tracker mapped to the official programme list | P1 | G4 |

### E8 — Teacher Console
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E8.1 | Today's lesson view with teaching notes | P0 | G3 |
| E8.2 | Class progress board (who is where) | P0 | G3 |
| E8.3 | Stuck-student signal (repeated failed attempts) | P1 | G4 |
| E8.4 | Marking queue with answer key side-by-side | P0 | G3 |
| E8.5 | Multi-school context switching | P0 | G3 |

### E9 — School Admin Console
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E9.1 | Roster and class management | P0 | G2 |
| E9.2 | Schedule management per class | P0 | G2 |
| E9.3 | Tenant branding configuration | P0 | G2 |
| E9.4 | Tenant usage and adoption reporting | P0 | G4 |
| E9.5 | Tenant-scoped audit log view | P1 | G4 |

### E10 — Brolly Admin Console
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E10.1 | Tenant directory and provisioning | P0 | G1 |
| E10.2 | Content publishing controls | P0 | G2 |
| E10.3 | Cross-tenant dashboards from nightly rollups | P0 | G4 |
| E10.4 | Impersonation console with full audit | P0 | G2 |
| E10.5 | Entitlement grants | P0 | G2 |

### E11 — Branding & White-Label
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E11.1 | Runtime branding resolution (logo, colours, name) by tenant | P0 | G2 |
| E11.2 | Per-tenant app identity for mobile builds | P0 | G3 |
| E11.3 | Branded email and notification templates | P1 | G4 |

### E12 — Mobile Apps
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E12.1 | Single-codebase flavour pipeline producing signed AABs | P0 | G3 |
| E12.2 | Per-school Play Store listing under the school's name | P0 | G3 |
| E12.3 | Unlisted distribution for the pilot | P0 | G3 |
| E12.4 | Families policy and Repetitive Content compliance artefacts | P0 | G3 |
| E12.5 | Consumption-only (no in-app purchase surface) | P0 | G3 |

### E13 — Reporting & Analytics
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E13.1 | Nightly rollup jobs producing tenant-level aggregates | P0 | G4 |
| E13.2 | Student progress report (teacher, admin, guardian views) | P0 | G4 |
| E13.3 | Chapter-level difficulty analytics for content improvement | P2 | G5 |

### E14 — Platform Operations
| ID | Feature | Priority | Gate |
|---|---|---|---|
| E14.1 | Structured audit logging on all privileged actions | P0 | G2 |
| E14.2 | Observability: metrics, traces, error tracking with PII scrubbing | P0 | G2 |
| E14.3 | Backup and point-in-time restore, tested | P0 | G3 |
| E14.4 | Tenant data export | P1 | G4 |

---

## 12. Out-of-Scope Features

Explicitly excluded from v1.0. Each has a reason, because an undocumented exclusion returns as scope creep.

| Excluded | Reason | Revisit when |
|---|---|---|
| Live video classes | Materially different product surface; team of five cannot build both; schools already have their own timetable and teacher in the room | Post-pilot, if B2C demands it |
| In-app purchases in school apps | Play billing policy plus child-directed app review risk; revenue share; blocks five listings at once | Only if parent-pays is chosen (§20.4 Q4), and then on web |
| Native iOS apps for schools | Pilot device base is Android; five iOS listings multiply review risk and cost | Year two, if a school requires it |
| School ERP / SIS integration | Every school's ERP differs; CSV import covers the pilot | When a named school makes it a contract condition |
| Teacher-authored custom content | Content correctness is a Brolly guarantee; opening authoring breaks the CBSE-mapping claim | After Content Hub versioning is mature |
| AI tutor / LLM chat for students | Child-directed generative AI carries safety obligations this team cannot discharge in the pilot window | Only with a dedicated safety review |
| Classes 1–4 and 10–12 | Curriculum does not exist; Class 10 requires the unpublished 2027–28 syllabus | When content exists |
| Marketplace / third-party content | No demand signal | Not planned |
| Multi-language UI | Pilot is English-medium; translation multiplies content QA | On first non-English-medium school |
| Behavioural analytics on child surfaces | Prohibited under DPDP for children | Never |
| Public Play Store listings for school apps during the pilot | Repetitive Content policy exposure across five near-identical apps | After the first listing survives review |
| Proctoring / webcam monitoring | Disproportionate for this age group; monitoring of children is prohibited | Never |

---

## 13. Functional Requirements

Requirements are numbered `FR-<module>-<n>`. Each is testable. Priority: **M** must-have for pilot, **S** should-have, **C** could-have.

### 13.1 FR-TEN — Tenancy & Isolation

| ID | Requirement | Pri |
|---|---|---|
| FR-TEN-01 | Every tenant-owned table shall carry `tenant_id` declared `NOT NULL`, with a foreign key to `Tenant`. | M |
| FR-TEN-02 | The system shall enable row-level security with `FORCE ROW LEVEL SECURITY` on every tenant-owned table, so that the table owner is also subject to the policy. | M |
| FR-TEN-03 | The application shall connect using a dedicated database role that is not a superuser and does not hold `BYPASSRLS`. | M |
| FR-TEN-04 | Every request shall establish a tenant context on the database session before any tenant-scoped query executes; a request without a resolvable tenant context shall be rejected, not defaulted. | M |
| FR-TEN-05 | Background tasks shall inherit tenant context through a `TenantTask` base class; a task class not deriving from it shall fail a CI check rather than run unscoped. | M |
| FR-TEN-06 | The system shall support two deployment classes: shared, and conditionally isolated for tenants whose contract requires it, running identical application code. | M |
| FR-TEN-07 | The system shall provide tenant lifecycle states: `provisioning`, `active`, `suspended`, `archived`, with defined behaviour for user access in each. | M |
| FR-TEN-08 | Tenant #1 shall be the B2C tenant and shall be created by the same provisioning path as any school tenant, with no special-case code. | M |
| FR-TEN-09 | CI shall run an isolation test suite that, for each tenant-scoped model, asserts that a query under tenant A returns zero rows belonging to tenant B. A failure shall block the build. | M |
| FR-TEN-10 | Cross-tenant reads shall be possible only through a documented, audited rollup path (FR-RPT-04), never through direct row access. | M |

### 13.2 FR-IAM — Identity, Membership, Authentication

| ID | Requirement | Pri |
|---|---|---|
| FR-IAM-01 | The system shall maintain a single global `User` record per human, independent of tenant. | M |
| FR-IAM-02 | Access to a tenant shall be granted exclusively by a `Membership` row binding `User` × `Tenant` × `Role` × status. | M |
| FR-IAM-03 | A user may hold multiple memberships, with different roles, across different tenants. | M |
| FR-IAM-04 | A user holding more than one active membership shall be presented with a tenant selector on login, and the active tenant shall be visible on every screen thereafter. | M |
| FR-IAM-05 | Students shall be able to authenticate without an email address, using a tenant-scoped roster identifier plus a credential issued by the school. | M |
| FR-IAM-06 | Brolly Admin shall be represented as a platform-level flag on `User`, not as a seeded membership inside any tenant. | M |
| FR-IAM-07 | Impersonation shall require a stated reason, shall expire automatically after a configured interval, shall display a persistent banner to the impersonating user, and shall write audit records on both entry and exit. | M |
| FR-IAM-08 | Revoking or changing a membership shall take effect on the next request, without requiring the affected user to log out. | M |
| FR-IAM-09 | The system shall support invitation-based onboarding for School Admins and Teachers, with time-limited, single-use tokens. | M |
| FR-IAM-10 | Failed authentication attempts shall be rate-limited per identifier and per source, with lockout thresholds that do not lock a whole class out because of one shared device. | S |
| FR-IAM-11 | Sessions shall be revocable per user and per tenant by a School Admin (own tenant) or Brolly Admin. | S |

### 13.3 FR-CON — Consent, Guardianship & Child Data

| ID | Requirement | Pri |
|---|---|---|
| FR-CON-01 | `Consent` shall be a first-class model recording: subject, grantor, tenant, purpose, policy version, `fiduciary_role`, grant timestamp, evidence reference, and expiry or withdrawal. | M |
| FR-CON-02 | `fiduciary_role` shall distinguish at minimum `brolly_as_fiduciary` (B2C) and `school_as_fiduciary` (B2B), and shall be set at grant time rather than derived at read time. | M |
| FR-CON-03 | Consent records shall be append-only. Withdrawal shall be recorded as a new event, never as a mutation of the original grant. | M |
| FR-CON-04 | The system shall not process person-scoped data for a subject without a current valid consent covering the stated purpose. | M |
| FR-CON-05 | In B2C, the account holder and consent grantor shall be a Guardian; a child shall not be able to self-register. | M |
| FR-CON-06 | The system shall not collect a full date of birth from a child where a class-level indicator is sufficient for the product to function. | M |
| FR-CON-07 | The system shall not implement behavioural tracking, profiling, session replay, attribution SDKs or targeted advertising on any surface reachable by a child. | M |
| FR-CON-08 | Withdrawal of consent shall trigger a defined downstream sequence: access suspension, processing halt, and a scheduled erasure job subject to statutory retention. | M |
| FR-CON-09 | The system shall provide a data-export function returning a subject's person-scoped data in a machine-readable format. | S |
| FR-CON-10 | The system shall support a verifiable parental consent flow. The verification mechanism shall be pluggable, because the acceptable mechanisms are set by the DPDP Rules and may change before enforcement. | S |
| FR-CON-11 | Every consent-relevant action shall be reconstructable from the audit log for at least the statutory minimum retention period. | M |

**Why FR-CON-02 exists.** In B2B the school is likely the fiduciary and Brolly the processor; in B2C Brolly is the fiduciary. That difference changes who must obtain consent, who answers a data-principal request, and who reports a breach. Deriving it from the tenant type at read time would silently produce the wrong answer the first time a school tenant contains a directly-billed parent. It is stored on the record. A written legal opinion on whether the DPDP educational-institution treatment reaches a B2B EdTech supplier is an open item (§19, R-6).

### 13.4 FR-CH — Content Hub

| ID | Requirement | Pri |
|---|---|---|
| FR-CH-01 | Content models (`Course`, `Chapter`, `Lesson`, `Block`, `Exercise`, `AnswerKey`, `Asset`) shall carry no `tenant_id`. | M |
| FR-CH-02 | The Content Hub shall support ingestion of existing textbook HTML into structured content blocks, preserving code blocks, expected-output blocks, images and answer boxes. | M |
| FR-CH-03 | Published content versions shall be immutable. Corrections shall create a new version. | M |
| FR-CH-04 | Each chapter shall record CBSE mapping metadata: class, track, and per-topic classification as official-syllabus or Brolly-addition. | M |
| FR-CH-05 | Each exercise shall carry a starter state, an expected output or assertion set, and an answer key with a worked explanation. | M |
| FR-CH-06 | Every code example and exercise solution shall be executed by an automated job as part of publishing; a fragment that does not produce its recorded output shall block publication. | M |
| FR-CH-07 | The system shall record, per published version, which tenants are entitled to it, so a content correction can be traced to affected classes. | S |
| FR-CH-08 | Any surface that displays CBSE alignment shall render the official/addition distinction and shall not describe Brolly additions as examined content. | M |
| FR-CH-09 | Assets shall be served from a CDN-backed store with cache-busting on version change. | S |
| FR-CH-10 | Authors shall be able to preview a chapter as it will appear to a Student and to a Teacher before publishing. | S |

**Why FR-CH-06 exists.** The existing textbook series was built with executed-and-verified code and with countable claims checked independently; two series-wide defects were previously found only after delivery. Making execution a publish gate moves that discipline from a habit into a mechanism.

### 13.5 FR-ENT — Entitlement & Scheduling

| ID | Requirement | Pri |
|---|---|---|
| FR-ENT-01 | Entitlement shall be a tenant-scoped record granting a tenant access to a course at a specified content version or version range. | M |
| FR-ENT-02 | A tenant shall be able to define classes and sections, and to assign students to exactly one section per course. | M |
| FR-ENT-03 | Schedule shall be tenant-scoped and shall map chapters of an entitled course to dates or week ranges for a specific class or section. | M |
| FR-ENT-04 | A student shall see a chapter only if their tenant is entitled to the course **and** the schedule has released it. | M |
| FR-ENT-05 | Two tenants shall be able to schedule the same global chapter differently, with no duplication of content. | M |
| FR-ENT-06 | A teacher shall be able to release a chapter early or hold it back for their own class, if the School Admin has delegated that permission. | S |
| FR-ENT-07 | The B2C tenant shall support a self-paced release mode where progression is gated by completion rather than by date. | S |
| FR-ENT-08 | Roster import shall accept CSV, validate before committing, present a dry-run diff, and report per-row errors without partially applying the file. | M |
| FR-ENT-09 | Re-importing a roster shall reconcile against existing students rather than creating duplicates. | M |

### 13.6 FR-LRN — Learning Experience

| ID | Requirement | Pri |
|---|---|---|
| FR-LRN-01 | The chapter reader shall render all ingested block types faithfully on both web and mobile viewports. | M |
| FR-LRN-02 | The student shall have an embedded code editor based on CodeMirror 6 with Python syntax highlighting, indentation support and a run control. | M |
| FR-LRN-03 | Practice execution shall run in-browser via Pyodide with no server round-trip, and shall work after first load without network access for the runtime itself. | M |
| FR-LRN-04 | Runtime errors shall be surfaced with the original Python traceback preserved, plus a plain-language hint layer that does not replace the traceback. | M |
| FR-LRN-05 | Progress shall be recorded per student per chapter, including started, completed, XP earned and exercises passed. | M |
| FR-LRN-06 | XP, badges and streaks shall follow the scheme already established in the textbook series so that book and platform agree. | S |
| FR-LRN-07 | The student surface shall function on a low-cost Android device at the device tier defined in NFR-PRF-05. | M |
| FR-LRN-08 | Reading content shall remain available when connectivity drops mid-session, with submissions queued and flushed on reconnect. | C |
| FR-LRN-09 | The student surface shall contain no leaderboard or comparison feature that names another child. | M |

**Why FR-LRN-03 and FR-LRN-04 exist.** Pyodide in the browser makes practice free at the margin and instant, which is the difference between a child trying twenty things and trying three. Preserving the real traceback matters because reading an error message is taught as a core skill in the Class 6 and Class 7 books; replacing it with a friendly message would contradict the curriculum the platform is delivering.

### 13.7 FR-CODE — Code Execution Service

| ID | Requirement | Pri |
|---|---|---|
| FR-CODE-01 | Graded submissions shall execute in the hosted Code Execution service, not in the browser. | M |
| FR-CODE-02 | Execution shall be sandboxed with no network egress, a wall-clock timeout, a memory ceiling and a filesystem restricted to a per-run temporary directory. | M |
| FR-CODE-03 | Each execution shall be tagged with tenant and subject identifiers for quota accounting and audit, and shall retain no persistent state between runs. | M |
| FR-CODE-04 | Execution shall be deterministic for grading: the same submission and the same test set shall produce the same verdict on re-run. | M |
| FR-CODE-05 | Per-tenant execution quotas shall be enforced, with a defined behaviour on exhaustion that degrades to practice-only rather than failing the lesson. | S |
| FR-CODE-06 | The service shall return structured results: stdout, stderr, exit status, duration, and per-assertion pass/fail. | M |
| FR-CODE-07 | Submitted source shall be retained only as long as needed for grading, review and appeal, then subject to the person-scoped retention policy. | M |

### 13.8 FR-ASM — Assessment

| ID | Requirement | Pri |
|---|---|---|
| FR-ASM-01 | The quiz engine shall support MCQ, multi-select, short text, and predict-the-output item types. | M |
| FR-ASM-02 | Code exercises shall be auto-graded against the answer key's assertion set. | M |
| FR-ASM-03 | A teacher shall be able to override any auto-grade, with a mandatory reason recorded in the audit log. | M |
| FR-ASM-04 | Attempt history shall be preserved; a re-attempt shall not overwrite the prior attempt. | M |
| FR-ASM-05 | For Class 9, the system shall track the official 417 practical-file programme list and show a student which numbered programmes are complete. | S |
| FR-ASM-06 | Scores shall never be displayed to a student in a way that ranks them against named peers. | M |

### 13.9 FR-TCH — Teacher Console

| ID | Requirement | Pri |
|---|---|---|
| FR-TCH-01 | A teacher shall see a "today" view for each assigned class, showing the scheduled chapter and its teaching notes. | M |
| FR-TCH-02 | A teacher shall see a class progress board indicating, per student, the current chapter and outstanding work. | M |
| FR-TCH-03 | A teacher shall see a marking queue containing submissions requiring manual review, with the answer key visible alongside. | M |
| FR-TCH-04 | A teacher holding memberships in multiple tenants shall switch tenant without logging out, and the active tenant and school branding shall be unambiguous on every screen. | M |
| FR-TCH-05 | The system shall flag students with repeated failed attempts on the same exercise. | S |
| FR-TCH-06 | A teacher shall be able to leave feedback on a submission, visible to that student only. | S |
| FR-TCH-07 | A teacher shall have no access to any class not assigned to them within the active tenant. | M |

### 13.10 FR-SAD — School Admin Console

| ID | Requirement | Pri |
|---|---|---|
| FR-SAD-01 | A School Admin shall manage the tenant roster, classes, sections and teacher assignments. | M |
| FR-SAD-02 | A School Admin shall configure the chapter schedule for each class. | M |
| FR-SAD-03 | A School Admin shall configure tenant branding: display name, logo, primary colour and support contact. | M |
| FR-SAD-04 | A School Admin shall see tenant-level adoption reporting: active students, chapters completed, submissions graded, by class. | M |
| FR-SAD-05 | A School Admin shall view a tenant-scoped audit log covering roster changes, role grants, impersonation events affecting their tenant, and data exports. | S |
| FR-SAD-06 | A School Admin shall be able to export their tenant's data. | S |
| FR-SAD-07 | A School Admin shall have no access to any other tenant, and no access to answer keys. | M |

### 13.11 FR-BAD — Brolly Admin Console

| ID | Requirement | Pri |
|---|---|---|
| FR-BAD-01 | Brolly Admin shall provision, configure and suspend tenants, including assigning the deployment class. | M |
| FR-BAD-02 | Brolly Admin shall grant and revoke tenant entitlements to courses and content versions. | M |
| FR-BAD-03 | Brolly Admin shall publish content versions and view publication history. | M |
| FR-BAD-04 | Brolly Admin cross-tenant dashboards shall read exclusively from nightly rollups and shall not query person-scoped rows. | M |
| FR-BAD-05 | Brolly Admin shall access individual records only through impersonation as specified in FR-IAM-07. | M |
| FR-BAD-06 | Brolly Admin shall view the platform-wide audit log, including all impersonation sessions. | M |
| FR-BAD-07 | The impersonation console shall show, before entry, whose data is about to be accessed and under which tenant. | M |

**Why FR-BAD-04 exists.** Two reasons that point the same way. Privacy: a support dashboard that lists children's work across five schools is exactly the kind of casual cross-tenant access the isolation model exists to prevent. Performance: a cross-tenant live query defeats every tenant-scoped index the schema is built around.

### 13.12 FR-BRD — Branding & White-Label

| ID | Requirement | Pri |
|---|---|---|
| FR-BRD-01 | Branding shall be resolved at runtime from the active tenant, not compiled per build for the web application. | M |
| FR-BRD-02 | Branding shall cover display name, logo, colour palette, app title and support contact, with a validated fallback to Brolly defaults. | M |
| FR-BRD-03 | Any screen visible to a school user shall display that school's branding and shall not display Brolly branding except where legally or contractually required. | M |
| FR-BRD-04 | Transactional emails and push notifications shall use the tenant's branding. | S |
| FR-BRD-05 | Branding assets shall be validated on upload for dimensions, format, and file size. | S |

### 13.13 FR-MOB — Mobile Applications

| ID | Requirement | Pri |
|---|---|---|
| FR-MOB-01 | A single codebase and a single commit shall produce all school app flavours as signed AABs, with per-flavour application ID, name, icon and branding. | M |
| FR-MOB-02 | Each school shall have its own Play Store application, published under a listing that identifies the school. | M |
| FR-MOB-03 | Pilot apps shall use unlisted distribution rather than public listings. | M |
| FR-MOB-04 | Each listing shall carry the artefacts required by Google's Families policy, including target-age declaration, content rating and a privacy policy URL appropriate to that tenant. | M |
| FR-MOB-05 | School apps shall contain no purchase surface, no pricing, and no link to a purchase flow. | M |
| FR-MOB-06 | Each flavour shall be materially differentiated in listing metadata and in-app branding to address Google's Repetitive Content policy. | M |
| FR-MOB-07 | The mobile app shall support the same student and teacher journeys as the web application for the P0 feature set. | M |
| FR-MOB-08 | Release signing keys shall be managed centrally with per-flavour separation and documented recovery. | M |

**Why FR-MOB-03 and FR-MOB-06 exist together.** Five apps built from one codebase, differing mainly by logo and colour, is the fact pattern Google's Repetitive Content policy is written for. Unlisted distribution reduces exposure during the pilot; genuine per-tenant differentiation in metadata and content reduces it at review. Both are needed; neither alone is sufficient.

### 13.14 FR-RPT — Reporting & Analytics

| ID | Requirement | Pri |
|---|---|---|
| FR-RPT-01 | Nightly jobs shall compute tenant-level and class-level aggregates from person-scoped activity. | M |
| FR-RPT-02 | Rollup jobs shall run under `TenantTask` and shall never execute unscoped. | M |
| FR-RPT-03 | Teacher and School Admin reports shall read from live tenant-scoped data within their own tenant. | M |
| FR-RPT-04 | Brolly Admin cross-tenant reports shall read only from rollups, with the computation timestamp displayed. | M |
| FR-RPT-05 | Reports shall be exportable to CSV. | S |
| FR-RPT-06 | Guardians shall see a progress view for their linked child only, containing no other child's data. | S |
| FR-RPT-07 | No analytics instrumentation shall run on a student surface beyond what is required to deliver and grade the lesson. | M |

### 13.15 FR-AUD — Audit & Platform Operations

| ID | Requirement | Pri |
|---|---|---|
| FR-AUD-01 | The system shall write an immutable audit record for: authentication, role grant/revoke, impersonation start/end, roster import, schedule change, content publish, entitlement change, grade override, data export and erasure. | M |
| FR-AUD-02 | Audit records shall include actor, tenant, action, target, timestamp, source address and, where applicable, the stated reason. | M |
| FR-AUD-03 | Audit records shall not be editable or deletable through any application path. | M |
| FR-AUD-04 | Error reporting shall scrub personal data before transmission to any third-party service. | M |
| FR-AUD-05 | Backups shall be automated, encrypted, and restore-tested on a defined schedule, with the isolated deployment class backed up separately. | M |

---

## 13A. Business Rules

Business rules are the invariants the system enforces regardless of interface. Every rule is stated as a testable condition, carries the requirement it derives from, and names where it is enforced. A rule enforced only in the UI is not enforced.

### 13A.1 Tenancy rules

| ID | Rule | Enforced at |
|---|---|---|
| BR-TEN-01 | Every tenant-owned row belongs to exactly one tenant, for its whole lifetime. A row's `tenant_id` is immutable after insert. | DB trigger + RLS |
| BR-TEN-02 | A row may never reference a row belonging to a different tenant. | Composite FK on `(id, tenant_id)` |
| BR-TEN-03 | B2C is Tenant #1 and is created, configured and billed through the same code paths as any school tenant. | Provisioning service |
| BR-TEN-04 | A suspended tenant permits no user login except Brolly Admin, and no background processing except retention jobs. | API middleware + task guard |
| BR-TEN-05 | An archived tenant is read-only for export purposes for a defined window, then subject to deletion. | Lifecycle job |
| BR-TEN-06 | No query executes without a tenant context except explicitly whitelisted platform queries (content, tenant directory, rollups). | Session GUC + RLS |

### 13A.2 Identity and membership rules

| ID | Rule | Enforced at |
|---|---|---|
| BR-IAM-01 | One human, one `User`. Duplicate identity by email or phone within the platform is rejected. | Unique constraint |
| BR-IAM-02 | Access to a tenant exists only through an active `Membership`. Deleting the membership removes access immediately. | Authorisation layer |
| BR-IAM-03 | A user may hold at most one active membership per tenant, but any number across tenants. | Partial unique index |
| BR-IAM-04 | A user may hold different roles in different tenants; roles never leak between tenants. | RBAC resolution per request |
| BR-IAM-05 | A Student membership may belong to exactly one section per course within its tenant. | Unique constraint |
| BR-IAM-06 | Brolly Admin is a platform flag on `User`. It is never expressed as a Membership row. | Schema + provisioning guard |
| BR-IAM-07 | Impersonation cannot begin without a stated reason and cannot exceed the configured TTL. | Impersonation service |
| BR-IAM-08 | An impersonator inherits the target's permissions minus all write actions that create graded artefacts or financial records. | Permission resolver |
| BR-IAM-09 | Student credentials are issued by the tenant, never self-chosen at first login, and must be changed on first use. | Auth service |

### 13A.3 Consent and child-data rules

| ID | Rule | Enforced at |
|---|---|---|
| BR-CON-01 | No person-scoped write occurs for a subject without a current, unwithdrawn consent covering the purpose. | Service-layer consent gate |
| BR-CON-02 | Consent records are append-only. Withdrawal is a new row; the original grant is never mutated or deleted. | DB trigger blocking UPDATE/DELETE |
| BR-CON-03 | `fiduciary_role` is written at grant time from the tenant's contracted position, never derived at read time. | Consent service |
| BR-CON-04 | In B2C, the account holder is a Guardian. A child cannot self-register, self-purchase, or grant their own consent. | Registration flow + role check |
| BR-CON-05 | Withdrawal suspends access within one request cycle and schedules erasure subject to statutory retention. | Consent service + retention job |
| BR-CON-06 | No behavioural analytics, attribution, advertising or session-replay SDK may be loaded on any surface reachable by a Student. | Build-time scan (CI gate) |
| BR-CON-07 | Full date of birth is not collected where class level is sufficient. | Schema (no DOB column on student profile) |
| BR-CON-08 | Every consent state change writes an audit record. | DB trigger |

### 13A.4 Content and entitlement rules

| ID | Rule | Enforced at |
|---|---|---|
| BR-CNT-01 | Content rows carry no `tenant_id` and are never duplicated per tenant. | Schema |
| BR-CNT-02 | A published `content_version` is immutable. Corrections create a new version. | DB trigger |
| BR-CNT-03 | Publication is blocked unless every code fragment in the version has been executed and matched its recorded output. | Publish pipeline gate |
| BR-CNT-04 | A tenant sees a course only if an active `Entitlement` exists for that tenant, course and version window. | Query layer + RLS |
| BR-CNT-05 | A student sees a chapter only if the tenant is entitled **and** the section's schedule has released it. | Query layer |
| BR-CNT-06 | Every topic displayed with a CBSE claim carries an official-versus-Brolly-addition flag, and Brolly additions are never described as examined. | Content model + render guard |
| BR-CNT-07 | Tenant data references content by pinned version, never by mutable content row. | FK to `content_version` |
| BR-CNT-08 | Two tenants may schedule the same chapter on different dates with no content duplication. | Schedule model |

### 13A.5 Learning and assessment rules

| ID | Rule | Enforced at |
|---|---|---|
| BR-ASM-01 | Practice execution never produces a graded record. Only submissions through the Code Execution service can be graded. | Execution service boundary |
| BR-ASM-02 | Grading is deterministic: identical source and identical test set yield an identical verdict. | Sandbox contract + regression test |
| BR-ASM-03 | Attempts are append-only. A re-attempt never overwrites an earlier attempt. | Schema + trigger |
| BR-ASM-04 | A teacher may override any auto-grade, but only with a recorded reason, and both verdicts are retained. | Grading service |
| BR-ASM-05 | A teacher may grade only submissions from sections assigned to them within the active tenant. | Authorisation layer |
| BR-ASM-06 | No student-facing surface ranks, names or compares another named child. | UI contract + API projection |
| BR-ASM-07 | XP awarded by the platform matches the XP printed in the corresponding textbook chapter. | Content metadata as single source |
| BR-ASM-08 | An exercise cannot be published without an answer key and an expected output or assertion set. | Publish validation |

### 13A.6 Scheduling and roster rules

| ID | Rule | Enforced at |
|---|---|---|
| BR-SCH-01 | Roster import is all-or-nothing per file. A file with any invalid row applies none of it. | Import transaction |
| BR-SCH-02 | Re-import matches existing students by tenant-scoped roster identifier and updates rather than duplicating. | Import reconciliation |
| BR-SCH-03 | A chapter cannot be scheduled for a section whose tenant is not entitled to the parent course. | Validation |
| BR-SCH-04 | Schedule release dates are tenant-local; the tenant's timezone governs release, not the server's. | Schedule service |
| BR-SCH-05 | A teacher may adjust release only for sections assigned to them, and only if the School Admin has delegated it. | Permission flag on membership |
| BR-SCH-06 | Removing a student from a section preserves their prior attempts and progress. | Soft-unlink, never cascade delete |

### 13A.7 Branding and white-label rules

| ID | Rule | Enforced at |
|---|---|---|
| BR-BRD-01 | Web branding resolves at runtime from the active tenant; it is never compiled per tenant. | Branding resolver |
| BR-BRD-02 | Mobile branding is resolved at build time per Expo flavour **and** re-verified at runtime against the tenant the user authenticates into. A mismatch blocks the session. | Build config + auth guard |
| BR-BRD-03 | A school user never sees Brolly branding except where a legal notice requires the processor to be named. | Render guard |
| BR-BRD-04 | A school app authenticates users of exactly one tenant. A user with no membership in that tenant cannot log in through that app. | Auth service |
| BR-BRD-05 | No school app contains a purchase surface, price, or link to one. | CI scan (build fails) |

### 13A.8 Commercial rules

| ID | Rule | Enforced at |
|---|---|---|
| BR-COM-01 | Pricing is per student per term in both channels. | Billing service |
| BR-COM-02 | Seat count for a B2B invoice is the count of active Student memberships at the billing snapshot date, not the imported roster size. | Billing snapshot job |
| BR-COM-03 | A student who joins mid-term is billed pro-rata; a student who leaves is not refunded within the term unless the contract says so. | Billing rules table |
| BR-COM-04 | B2C purchase is made by a Guardian, never by a Student. | Checkout guard |
| BR-COM-05 | Lapsed payment suspends new content release but never deletes completed work or revokes the practical file. | Entitlement expiry behaviour |
| BR-COM-06 | Invoices are immutable once issued; corrections are credit notes. | Schema + trigger |

*BR-COM-02 and BR-COM-03 depend on the payer decision in §20.4 Q4 and are provisional until it is made.*

### 13A.9 Operational and audit rules

| ID | Rule | Enforced at |
|---|---|---|
| BR-AUD-01 | Every privileged action writes an immutable audit record with actor, tenant, action, target, timestamp and reason where applicable. | DB triggers + service layer |
| BR-AUD-02 | Audit records cannot be updated or deleted through any application path. | Revoked grants + trigger |
| BR-AUD-03 | Personal data is scrubbed before any log or error report leaves the platform boundary. | Logging middleware |
| BR-AUD-04 | Retention is enforced by scheduled jobs, not by manual action. | Retention scheduler |
| BR-AUD-05 | A School Admin can see every impersonation event affecting their tenant. | Audit query scope |

---

## 14. Non-Functional Requirements

### 14.1 NFR-PRF — Performance

| ID | Requirement | Target |
|---|---|---|
| NFR-PRF-01 | Chapter reader time-to-interactive on a mid-range Android device over 4G | ≤ 3.0 s p75 |
| NFR-PRF-02 | API response time for tenant-scoped read endpoints | ≤ 300 ms p95 |
| NFR-PRF-03 | Pyodide first-load (cold, cached thereafter) | ≤ 8 s p75; subsequent loads ≤ 1.5 s |
| NFR-PRF-04 | Practice code run-to-output after runtime load | ≤ 500 ms p95 for programmes in the Classes 5–9 curriculum |
| NFR-PRF-05 | Reference device floor for the student surface | 3 GB RAM Android device, Chrome/WebView current-minus-two |
| NFR-PRF-06 | Graded submission verdict returned | ≤ 5 s p95 under pilot concurrency |
| NFR-PRF-07 | Roster import of 1,000 students | ≤ 60 s, with progress feedback |

**Why NFR-PRF-03 is generous and NFR-PRF-04 is strict.** Pyodide is a large one-time download; students accept a wait once. What they will not tolerate is a delay on every run, which is why the runtime is in the browser rather than behind an API.

### 14.2 NFR-SCL — Scalability

| ID | Requirement |
|---|---|
| NFR-SCL-01 | The shared deployment shall support the pilot's five tenants plus Tenant #1 without per-tenant infrastructure. |
| NFR-SCL-02 | Adding a tenant shall require no schema change, no migration and no new deployment in the shared class. |
| NFR-SCL-03 | Every tenant-scoped query path shall use an index whose leading column is `tenant_id`. |
| NFR-SCL-04 | Year-two capacity targets are pending the school and student figures in §20.4 Q3. Capacity planning shall be redone once they exist. |

### 14.3 NFR-AVL — Availability & Resilience

| ID | Requirement |
|---|---|
| NFR-AVL-01 | Target availability during Indian school hours (07:00–17:00 IST, Mon–Sat): 99.5% monthly. |
| NFR-AVL-02 | Failure of the Code Execution service shall degrade gracefully: practice continues in-browser; graded submissions queue. |
| NFR-AVL-03 | RPO ≤ 15 minutes, RTO ≤ 4 hours, both restore-tested before Gate 3. |
| NFR-AVL-04 | Planned maintenance shall be scheduled outside school hours and announced per tenant. |

### 14.4 NFR-SEC — Security

| ID | Requirement |
|---|---|
| NFR-SEC-01 | TLS 1.2+ in transit; encryption at rest for database, backups and object storage. |
| NFR-SEC-02 | RLS is the isolation control of record. Application-level filtering is defence in depth, not the primary control. |
| NFR-SEC-03 | The application database role shall hold least privilege and shall not be able to disable RLS. |
| NFR-SEC-04 | Secrets shall be held in a managed secret store; no credentials in source control, enforced by a CI scan. |
| NFR-SEC-05 | Untrusted code executes only in the Code Execution sandbox, with no network egress and enforced resource limits. |
| NFR-SEC-06 | Dependency vulnerability scanning shall run on every build; critical findings block release. |
| NFR-SEC-07 | An external penetration test focused on tenant isolation shall be completed before onboarding a school beyond the pilot five. |

### 14.5 NFR-PRV — Privacy & Regulatory Compliance

| ID | Requirement |
|---|---|
| NFR-PRV-01 | The platform shall meet DPDP Act 2023 and DPDP Rules 2025 obligations applicable to children's data before 13 May 2027. |
| NFR-PRV-02 | Data minimisation: no field shall be collected without a recorded purpose. A field-justification record shall exist for every personal-data field. |
| NFR-PRV-03 | No tracking, behavioural monitoring, profiling or targeted advertising directed at children, on any surface. |
| NFR-PRV-04 | Retention periods shall be defined per data zone and enforced by scheduled deletion jobs, not by manual process. |
| NFR-PRV-05 | Personal-data breach detection and notification procedures shall meet the 72-hour reporting expectation. |
| NFR-PRV-06 | Data residency: primary storage and processing in the Mumbai region. |
| NFR-PRV-07 | Sub-processors shall be listed, minimised, and disclosed to school tenants. |

### 14.6 NFR-CMP — Platform Policy Compliance

| ID | Requirement |
|---|---|
| NFR-CMP-01 | Every school app shall satisfy Google Play's Families policy for its declared target age group. |
| NFR-CMP-02 | Flavours shall satisfy the Repetitive Content policy through genuine per-tenant differentiation. |
| NFR-CMP-03 | No app shall contain a purchase surface (FR-MOB-05); a CI check shall fail the build if purchase-related strings or SDKs appear. |
| NFR-CMP-04 | Each listing shall reference a privacy policy naming the correct data fiduciary for that tenant. |

### 14.7 NFR-USE — Usability & Accessibility

| ID | Requirement |
|---|---|
| NFR-USE-01 | Student-facing copy shall target the reading age of the lowest class served by that surface (Class 5 for the Classes 5–6 experience). |
| NFR-USE-02 | WCAG 2.1 AA for colour contrast, keyboard navigation, focus order and form labelling on all surfaces. |
| NFR-USE-03 | The code editor shall be usable on a touch device, including indentation, without an external keyboard. |
| NFR-USE-04 | Every error state shall state what happened, why, and what to do next. |
| NFR-USE-05 | A School Admin shall complete first-time roster setup without written instructions beyond in-product guidance. |

### 14.8 NFR-MNT — Maintainability & Observability

| ID | Requirement |
|---|---|
| NFR-MNT-01 | One codebase, one commit, all tenants and all app flavours. No per-tenant branches. |
| NFR-MNT-02 | Migrations shall be backward-compatible within a release window and shall run identically across both deployment classes. |
| NFR-MNT-03 | Structured logs shall carry tenant and request identifiers; logs shall not contain personal data. |
| NFR-MNT-04 | Metrics, traces and error tracking shall be in place before the first school goes live. |
| NFR-MNT-05 | Every rule in this PRD that can be enforced by a check shall have one: a written rule plus a failing test. A rule that exists only in prose degrades. |

### 14.9 NFR-DAT — Data Integrity

| ID | Requirement |
|---|---|
| NFR-DAT-01 | Referential integrity shall be enforced at the database level, including tenant consistency across related rows. |
| NFR-DAT-02 | A row shall never reference a row belonging to a different tenant; this shall be enforced by constraint, not convention. |
| NFR-DAT-03 | Attempt and submission history shall be append-only. |
| NFR-DAT-04 | Content version references from tenant data shall pin to an immutable version. |

---

## 15. User Stories

Stories are grouped by persona, numbered `US-<persona>-<n>`, sized for a sprint, and linked to the functional requirements they satisfy. Acceptance criteria are written Given/When/Then and are binding on QA.

### 15.1 Brolly Admin

**US-BA-01 — Provision a school tenant**
*As a Brolly Admin, I want to create a new school tenant with its deployment class and branding, so that a school can be onboarded without an engineering task.*
Satisfies FR-TEN-01, FR-TEN-06, FR-TEN-07, FR-BAD-01.

- **Given** I am a Brolly Admin, **when** I create a tenant with a name, short code, deployment class and School Admin invite address, **then** the tenant is created in `provisioning` state and an invitation is sent.
- **Given** a tenant in `provisioning`, **when** the School Admin accepts the invitation and completes branding, **then** the tenant moves to `active` and student logins become possible.
- **Given** a tenant marked for the isolated deployment class, **when** it is provisioned, **then** its data is created in the isolated database and no row for it exists in the shared database.
- **Given** any tenant, **when** it is created, **then** no code path specific to that tenant exists; the same provisioning path created Tenant #1.

**US-BA-02 — See platform adoption without reading children's work**
*As a Brolly Admin, I want cross-school adoption figures, so that I can run the business without accessing individual student records.*
Satisfies FR-BAD-04, FR-RPT-01, FR-RPT-04.

- **Given** nightly rollups have run, **when** I open the cross-tenant dashboard, **then** I see per-tenant active students, chapters completed and submission counts, with the rollup timestamp displayed.
- **Given** I am on the cross-tenant dashboard, **when** any query executes, **then** no person-scoped table is read, verified by query-level assertion in test.
- **Given** rollups have not yet run for today, **when** I open the dashboard, **then** I see yesterday's figures clearly labelled, not an error and not live data.

**US-BA-03 — Investigate a reported problem via impersonation**
*As a Brolly Admin, I want to see exactly what a specific teacher sees, so that I can resolve a support ticket, with every such access recorded.*
Satisfies FR-IAM-07, FR-BAD-05, FR-BAD-07, FR-AUD-01.

- **Given** a support ticket, **when** I start impersonation, **then** I must select the target user and tenant and enter a reason before the session begins.
- **Given** an active impersonation session, **when** any page renders, **then** a persistent banner shows whose account I am in, which tenant, and the time remaining.
- **Given** an impersonation session, **when** the configured TTL elapses, **then** the session terminates automatically and I return to my own context.
- **Given** any impersonation session, **when** it starts and when it ends, **then** an immutable audit record is written including reason, and it is visible to the affected tenant's School Admin.
- **Given** I am impersonating a Student, **when** I attempt to submit graded work, **then** the action is refused.

**US-BA-04 — Publish a content correction**
*As a Brolly Admin, I want to publish a corrected chapter version, so that every entitled tenant gets the fix without content being copied per school.*
Satisfies FR-CH-03, FR-CH-06, FR-CH-07, FR-BAD-03.

- **Given** a chapter with a factual correction, **when** I publish, **then** a new immutable version is created and the previous version remains retrievable.
- **Given** a chapter containing code examples, **when** I publish, **then** every code fragment is executed and compared to its recorded output, and publication is blocked on any mismatch.
- **Given** a published correction, **when** I view the version record, **then** I can see which tenants and classes were on the previous version.

### 15.2 School Admin

**US-SA-01 — Import a roster of 400 students**
*As a School Admin, I want to upload my student list once, so that I do not create accounts by hand.*
Satisfies FR-ENT-08, FR-ENT-09, FR-SAD-01.

- **Given** a CSV with required columns, **when** I upload it, **then** I see a dry-run summary of rows to create, update and skip, before anything is committed.
- **Given** a CSV with errors in some rows, **when** I confirm, **then** no rows are applied and I receive a per-row error report.
- **Given** a corrected CSV containing students already imported, **when** I re-import, **then** existing students are matched and updated rather than duplicated.
- **Given** a successful import, **when** it completes, **then** an audit record is written naming me, the file and the row counts.

**US-SA-02 — Set the teaching schedule for my classes**
*As a School Admin, I want to control which chapter each section reaches and when, so that the platform follows my timetable rather than dictating it.*
Satisfies FR-ENT-03, FR-ENT-04, FR-ENT-05, FR-SAD-02.

- **Given** my tenant is entitled to a course, **when** I set a schedule for Class 7A, **then** students in 7A see only chapters released by that schedule.
- **Given** two sections on different schedules, **when** each student opens the app, **then** each sees their own section's release state, from the same global content.
- **Given** another school on the same course, **when** I change my schedule, **then** their schedule is unaffected.

**US-SA-03 — Present the platform as my school's own**
*As a School Admin, I want the app and emails to carry my school's identity, so that parents see our programme rather than a vendor's.*
Satisfies FR-BRD-01, FR-BRD-02, FR-BRD-03, FR-BRD-04.

- **Given** I upload a logo and set a colour, **when** any user in my tenant loads any screen, **then** my branding is applied without a rebuild or redeploy.
- **Given** branding is set, **when** a transactional email is sent to my users, **then** it carries my school's identity.
- **Given** an invalid logo file, **when** I upload it, **then** I get a specific validation error and the previous branding remains in force.

**US-SA-04 — Answer the data-separation question**
*As a School Admin whose management asked about data separation, I want a clear account of where my students' data lives and who can see it, so that I can answer the governing body.*
Satisfies FR-TEN-02, FR-TEN-06, FR-SAD-05, FR-CON-01.

- **Given** I am a School Admin, **when** I open the data and privacy page, **then** I see where my tenant's data is stored, which deployment class it uses, the sub-processor list, and the retention periods per data type.
- **Given** a Brolly Admin has impersonated a user in my tenant, **when** I open my audit log, **then** that session appears with actor, target, reason and duration.
- **Given** I request an export, **when** it completes, **then** I receive my tenant's data and nothing belonging to another tenant.

*Note: the precise contractual wording of this school's requirement is outstanding (§20.4 Q2). This story satisfies transparency; whether it satisfies the contract cannot be confirmed until the wording is received.*

### 15.3 Teacher

**US-TE-01 — Teach today's lesson without preparation time I do not have**
*As a Teacher, I want the scheduled chapter and its notes on one screen, so that I can walk into the period and teach.*
Satisfies FR-TCH-01, FR-CH-05.

- **Given** I have a class scheduled today, **when** I open the console, **then** I see today's chapter, its teaching notes, its exercises and its answer keys.
- **Given** a code example in the notes, **when** I run it, **then** it produces the output printed beside it.

**US-TE-02 — Work across three schools from one login**
*As a Brolly-supplied Teacher, I want one account for all my schools, so that I never mark the wrong school's class.*
Satisfies FR-IAM-03, FR-IAM-04, FR-TCH-04, PERM-03.

- **Given** I hold Teacher memberships in three tenants, **when** I log in, **then** I choose a tenant and land in that tenant's branded console.
- **Given** I am in tenant A, **when** I view any screen, **then** the active school's name and branding are visible without scrolling.
- **Given** I am in tenant A, **when** I attempt to open a URL identifying a class in tenant B, **then** access is denied at the data layer, not merely hidden in the UI.
- **Given** my membership in tenant B is revoked while I am logged in, **when** I make my next request scoped to tenant B, **then** it is denied.

**US-TE-03 — Mark a class of forty without reading forty files**
*As a Teacher, I want auto-graded work with a queue of only what needs my judgement, so that marking fits inside a free period.*
Satisfies FR-ASM-02, FR-ASM-03, FR-TCH-03.

- **Given** students have submitted code exercises, **when** I open the marking queue, **then** auto-graded passes are excluded and only items needing review are listed.
- **Given** a submission in the queue, **when** I view it, **then** the student's code, its actual output, the expected output and the answer key are visible together.
- **Given** I disagree with an auto-grade, **when** I override it, **then** I must enter a reason and both the original verdict and the override are retained.

**US-TE-04 — Find the students who are stuck**
*As a Teacher, I want to see who has failed the same exercise repeatedly, so that I can help the right children.*
Satisfies FR-TCH-05, FR-ASM-04.

- **Given** a student has failed the same exercise three or more times, **when** I open the progress board, **then** that student is flagged with the exercise named.
- **Given** the flag, **when** I open it, **then** I see the attempt history in order, not only the latest attempt.

### 15.4 Student

**US-ST-01 — Write and run Python with nothing to install**
*As a Student, I want to type code and see it run immediately, so that I can experiment.*
Satisfies FR-LRN-02, FR-LRN-03, FR-LRN-04, NFR-PRF-04.

- **Given** I open an exercise, **when** the page has loaded, **then** an editor with starter code and a Run control is present and no installation is required.
- **Given** I press Run, **when** the programme is valid, **then** output appears in under 500 ms at p95 without a network request for execution.
- **Given** my programme raises an exception, **when** it runs, **then** I see the real Python traceback plus a plain-language hint, and the traceback is not hidden.
- **Given** I am offline after first load, **when** I press Run on a practice exercise, **then** it still runs.

**US-ST-02 — Submit graded work**
*As a Student, I want to submit an exercise for marking and know the result, so that my work counts.*
Satisfies FR-CODE-01, FR-CODE-04, FR-CODE-06, FR-ASM-04.

- **Given** a graded exercise, **when** I submit, **then** the code executes on the server and I receive a per-assertion result.
- **Given** the Code Execution service is unavailable, **when** I submit, **then** my submission is queued, I am told so plainly, and practice continues to work.
- **Given** I submit the same code twice, **when** both are graded, **then** the verdicts are identical.
- **Given** I re-attempt an exercise, **when** I submit again, **then** my earlier attempt is still visible to me and my teacher.

**US-ST-03 — See only what my class has reached**
*As a Student, I want the app to show me the chapter we are on, so that I am not lost in content we have not covered.*
Satisfies FR-ENT-04, FR-LRN-05.

- **Given** my section's schedule has released chapters 1–4, **when** I open the course, **then** chapters 5 onward are shown as locked, not simply hidden with no explanation.
- **Given** a chapter I have completed, **when** I return to it, **then** my prior work and XP are intact.

**US-ST-04 — Use it on the family phone**
*As a Student, I want the app to work on a shared Android phone, so that I can practise at home.*
Satisfies FR-LRN-07, NFR-PRF-01, NFR-PRF-05, NFR-USE-03.

- **Given** a 3 GB RAM Android device, **when** I open a chapter, **then** it is interactive within 3 seconds at p75 on 4G.
- **Given** the on-screen keyboard, **when** I write an indented block, **then** indentation is achievable without an external keyboard.

### 15.5 Guardian

**US-GU-01 — Give consent, and be able to withdraw it**
*As a Guardian, I want to grant consent for my child and to withdraw it later, so that I remain in control of my child's data.*
Satisfies FR-CON-01, FR-CON-03, FR-CON-04, FR-CON-05, FR-CON-08.

- **Given** I am registering my child in B2C, **when** I complete sign-up, **then** the account is in my name, my child is a profile under it, and a consent record is written with purpose, policy version and `fiduciary_role`.
- **Given** consent has not been granted, **when** any person-scoped processing for my child is attempted, **then** it is refused.
- **Given** I withdraw consent, **when** the withdrawal is recorded, **then** a new event is appended, the original grant is unchanged, access is suspended and an erasure job is scheduled subject to statutory retention.
- **Given** any consent action, **when** I later request the history, **then** every grant and withdrawal is retrievable with timestamps.

**US-GU-02 — See my own child's progress and nobody else's**
*As a Guardian, I want to see how my child is doing, so that I know the money is doing something.*
Satisfies FR-RPT-06, PERM-05, FR-LRN-09.

- **Given** I am linked to one child, **when** I open the progress view, **then** I see only that child's chapters, XP and completion.
- **Given** the progress view, **when** it renders, **then** no other child is named, ranked or referenced.

### 15.6 Cross-cutting / Platform

**US-PL-01 — Background work never escapes its tenant**
*As the platform, I want every background task to carry tenant context, so that a nightly job cannot read across tenants.*
Satisfies FR-TEN-05, FR-RPT-02.

- **Given** a Celery task derived from `TenantTask`, **when** it runs, **then** it establishes the tenant context before its first query.
- **Given** a task class not derived from `TenantTask`, **when** CI runs, **then** the build fails with the offending class named.
- **Given** a task that must operate across tenants, **when** it runs, **then** it iterates tenants explicitly, one context at a time, and this is the only permitted pattern.

**US-PL-02 — Isolation is proven on every build**
*As the platform, I want automated proof that tenant A cannot read tenant B, so that isolation is a tested property rather than a claim.*
Satisfies FR-TEN-09, NFR-SEC-02.

- **Given** the isolation suite, **when** CI runs, **then** for every tenant-scoped model a query under tenant A returns zero rows owned by tenant B.
- **Given** a new tenant-scoped model is added without a `tenant_id` column or without an RLS policy, **when** CI runs, **then** the build fails.
- **Given** the application database role, **when** tested, **then** it cannot disable or bypass RLS.

**US-PL-03 — Five apps from one commit**
*As the platform, I want all school apps built from one commit, so that adding a school is configuration rather than engineering.*
Satisfies FR-MOB-01, FR-MOB-06, FR-MOB-08, NFR-MNT-01.

- **Given** a release commit, **when** the pipeline runs, **then** one signed AAB per configured flavour is produced, each with its own application ID, name, icon and branding.
- **Given** a new school is added to the flavour configuration, **when** the pipeline runs, **then** its AAB is produced with no code change.
- **Given** any produced AAB, **when** scanned by CI, **then** no purchase surface, purchase SDK or pricing string is present.

---

## 16. Acceptance Criteria

§15 carries story-level criteria. This section defines the criteria that apply above the story level: what "done" means for a work item, what must be true to pass a release gate, and the test matrix QA owns.

### 16.1 Definition of Done (per work item)

A work item is done when all of the following hold:

1. Functional requirement IDs it implements are referenced in the pull request.
2. Automated tests cover the acceptance criteria of its user story, including the negative cases.
3. If it touches a tenant-scoped model, an isolation test exists for that model and passes.
4. If it introduces a background task, that task derives from `TenantTask`.
5. If it introduces a personal-data field, a field-justification entry exists (purpose, who sees it, retention).
6. If it introduces a privileged action, an audit record is written and asserted in test.
7. Accessibility checks pass for any new UI (contrast, focus order, labels, keyboard path).
8. Copy on any student surface has been reviewed against the reading-age requirement.
9. No new dependency with an unresolved critical vulnerability.
10. Observability: new failure modes emit a distinguishable, non-personal log or metric.

### 16.2 Release gate exit criteria

A release may ship to a school tenant only if **all** of the following pass. Any failure is a release blocker, not a known issue.

| ID | Gate criterion |
|---|---|
| AC-G-01 | Isolation suite green: zero cross-tenant reads across every tenant-scoped model |
| AC-G-02 | No task class outside `TenantTask`; CI check green |
| AC-G-03 | Application DB role verified as non-superuser without `BYPASSRLS`; RLS forced on every tenant-owned table |
| AC-G-04 | Impersonation cannot begin without a reason and produces paired entry/exit audit records |
| AC-G-05 | Consent gate verified: person-scoped processing refused without a valid grant |
| AC-G-06 | No analytics, attribution or session-replay SDK present on any child-reachable surface (build-time scan) |
| AC-G-07 | No purchase surface in any mobile flavour (build-time scan) |
| AC-G-08 | All published content executed and matching recorded output |
| AC-G-09 | Performance budgets in §14.1 met on the reference device |
| AC-G-10 | Backup restore tested within the release window |
| AC-G-11 | Accessibility audit passed on changed surfaces |
| AC-G-12 | Audit log complete for all privileged actions listed in FR-AUD-01 |

### 16.3 QA test matrix

| Test class | Scope | Frequency | Owner |
|---|---|---|---|
| Tenant isolation | Every tenant-scoped model; RLS policy presence; role privileges | Every build | Engineering + QA |
| Role/permission | Every cell of the §9.2 matrix, positive and negative | Every release | QA |
| Multi-tenant teacher | Tenant switching, cross-tenant denial, revocation mid-session | Every release | QA |
| Consent lifecycle | Grant, gate, withdraw, downstream suspension, erasure scheduling | Every release | QA + Compliance reviewer |
| Content fidelity | Rendered chapter vs source textbook; code execution vs recorded output | Every content publish | Content + QA |
| Code execution | Sandbox limits, timeouts, determinism, quota exhaustion behaviour | Every release | Engineering |
| Performance | §14.1 budgets on the reference device | Every release | QA |
| Accessibility | WCAG 2.1 AA on changed surfaces | Every release | QA |
| Mobile flavour | Per-flavour identity, branding, no-purchase scan, install on reference device | Every mobile release | QA |
| Restore | Backup restore to a scratch environment | Monthly and before each gate | Ops |
| Roster import | Dry run, partial failure, re-import idempotency, 1,000-row timing | Every release touching import | QA |

### 16.4 Pilot acceptance (business level)

The pilot is accepted when, for each of the five schools: the tenant is live with its own branding; its roster is imported and reconciled; at least one class has completed a scheduled chapter end to end including a graded submission; the School Admin has viewed adoption reporting; the school's app is installed on at least one teacher and one student device; and no cross-tenant incident has occurred.

---

## 17. Success Metrics

Metrics are grouped by what they prove. Every metric has a definition precise enough to instrument, and a baseline column that is honest about what is not yet known.

### 17.1 Adoption

| Metric | Definition | Baseline | Target |
|---|---|---|---|
| Schools live | Tenants in `active` with ≥1 class scheduled and ≥1 student active in 7 days | 0 | 5 by end of pilot |
| Student activation | Students with ≥1 completed exercise / students imported | None | ≥ 70% within 3 weeks of tenant go-live |
| Teacher activation | Teachers opening the console in ≥3 of 4 scheduled weeks | None | ≥ 80% |
| Weekly active students | Distinct students with ≥1 session in a calendar week | None | ≥ 60% of imported roster, sustained |

### 17.2 Learning

| Metric | Definition | Baseline | Target |
|---|---|---|---|
| Chapter completion rate | Chapters completed / chapters released, per class | None | ≥ 75% |
| Exercise pass rate | Exercises passed / attempted, per chapter | None | 60–85% band (below = too hard, above = too easy) |
| Median attempts to pass | Attempts before first pass, per exercise | None | ≤ 3 |
| Schedule adherence | Classes within ±1 chapter of their schedule | None | ≥ 80% of classes |
| Class 9 practical-file completion | Numbered programmes completed / required | None | 100% of the required minimum before the practical exam window |

### 17.3 Product quality

| Metric | Definition | Target |
|---|---|---|
| Cross-tenant incidents | Confirmed instances of data visible across tenants | **0**, non-negotiable |
| Practice run latency | p95 run-to-output after runtime load | ≤ 500 ms |
| Graded submission latency | p95 submit-to-verdict | ≤ 5 s |
| Availability in school hours | Uptime 07:00–17:00 IST | ≥ 99.5% |
| Content defects found post-publish | Factual or arithmetic errors reported per 100 published pages | ≤ 1 |
| Crash-free sessions (mobile) | Sessions without a fatal error | ≥ 99.5% |

### 17.4 Commercial

| Metric | Definition | Target |
|---|---|---|
| Pilot-to-paid conversion | Schools renewing after pilot | ≥ 4 of 5 |
| Onboarding effort | Person-hours from contract to tenant live | ≤ 8 hours by the third school |
| Engineering cost per new school | Developer-days to add a tenant and its app flavour | ≤ 1 |
| Infrastructure cost per active student per month | Total infra ÷ monthly active students | Ceiling pending §20.4 Q3 |
| B2C paid learners | Active paid learners in Tenant #1 | Pending §20.4 Q3 |

### 17.5 Compliance

| Metric | Definition | Target |
|---|---|---|
| Consent coverage | Active learners with a valid current consent record | 100% |
| Impersonation sessions without a recorded reason | Count | 0 |
| Unscoped background task executions | Count | 0 |
| DPDP readiness items closed | Closed / total on the compliance checklist | 100% before 13 May 2027 |
| Time to fulfil a data-principal request | Days from request to completion | Within statutory period, measured |

**Metrics deliberately not collected.** No engagement-maximising metrics on child surfaces: no session-length targets, no daily-streak-pressure notifications tuned against behaviour, no funnel instrumentation on a student's screen. Beyond the DPDP prohibition on monitoring children, optimising a 10-year-old's time-on-app is not what this product is for.

---

## 18. KPIs

§17 defines everything measured. This section is the reporting layer: which numbers are reviewed, by whom, how often, and what happens when one moves the wrong way.

### 18.1 KPI tree

**North Star: weekly active students completing scheduled work.** Chosen because it is the only figure that is simultaneously a learning outcome, an adoption signal and a renewal predictor, and because it cannot be inflated by anything a child would not benefit from.

It decomposes into: *schools live* × *students per school activated* × *weekly completion rate*. Each branch has an owner.

### 18.2 Executive KPIs (monthly, leadership)

| KPI | Formula | Health thresholds |
|---|---|---|
| Weekly active students completing scheduled work | Distinct students with ≥1 chapter task completed in the week | Green ≥60% of roster · Amber 40–60% · Red <40% |
| Schools live | Count of `active` tenants with recent activity | Against plan |
| Pilot conversion rate | Renewing schools / pilot schools | Green ≥80% |
| Infra cost per active student | Monthly infra ÷ MAS | Threshold pending §20.4 Q3 |
| Open compliance items | Count of unclosed DPDP checklist items | Red if any item is unclosed within 90 days of 13 May 2027 |

### 18.3 Product KPIs (weekly)

| KPI | Why it is watched |
|---|---|
| Activation funnel: imported → first login → first exercise → first completion | Locates the drop-off; the first login step is where student authentication design is proved or disproved |
| Exercise pass-rate distribution by chapter | Any chapter outside the 60–85% band is a content-quality signal routed to the content designer |
| Median attempts to pass, by chapter | A high-attempt exercise is either badly worded or badly sequenced |
| Stuck-student count per class | Directly actionable by the teacher; also predicts a class falling behind schedule |
| Schedule drift | Classes more than one chapter behind predict a renewal problem before the school raises one |

### 18.4 Engineering & reliability KPIs (weekly)

Cross-tenant incidents (0), p95 API latency, p95 practice-run latency, p95 graded-submission latency, availability in school hours, crash-free session rate, failed background tasks, build-gate failure rate on AC-G-01 to AC-G-12, mean time to restore in the last restore test.

### 18.5 Compliance KPIs (monthly)

Consent coverage, impersonation sessions and their reason completeness, data-principal requests and time to fulfil, retention jobs completed on schedule, sub-processor list changes, open findings from the isolation penetration test.

### 18.6 Escalation rules

| Trigger | Response |
|---|---|
| Any cross-tenant incident | Immediate: halt releases, notify affected tenants, begin breach assessment against the 72-hour clock |
| Weekly active students red for two consecutive weeks in a tenant | Product and the account owner run a joint review with the School Admin before week three |
| A chapter's pass rate outside band for two weeks | Content review of that chapter, with a version fix planned |
| Availability below target in a school-hours window | Post-incident review with a written cause and a check that would have caught it |
| Any impersonation session without a reason | Treat as a control failure; the control is broken, not the person |

---

## 19. Risks

Scored as Likelihood (L) × Impact (I), each 1–5. Score ≥ 12 requires an owner and a dated mitigation.

### 19.1 Risk register

| ID | Risk | L | I | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R-1 | **Play Console account lead time delays all five school apps.** Account type and creation date are unresolved; new developer accounts can face verification and testing requirements before publishing. This is the longest external lead time on the critical path. | 4 | 5 | 20 | Start the Play Console process before any other mobile work. Resolve organisation-vs-individual account type this week. Plan the pilot so that web delivery alone can carry Gate 3 if listings slip. | Founder |
| R-2 | **Cross-tenant data leak.** A single leak ends the B2B channel and is a reportable breach involving children's data. | 2 | 5 | 10 | RLS with `FORCE ROW LEVEL SECURITY` on a non-superuser role; isolation suite blocking every build; `TenantTask`; external isolation pen-test before school six. | Engineering lead |
| R-3 | **The data-separation requirement, once received in writing, exceeds the isolated deployment class.** If the school means in-country-plus-audit, the current design meets it; if it means on-premise or school-controlled keys, it does not. | 3 | 4 | 12 | Obtain the wording before Gate 2. Do not build to a guess. Price and scope separately if it exceeds the isolated class. | Founder + Engineering lead |
| R-4 | **Repetitive Content rejection across five near-identical apps.** | 3 | 4 | 12 | Unlisted distribution for the pilot; genuine per-tenant differentiation in listing metadata and in-app content; stagger submissions so one rejection does not block five. | Mobile owner |
| R-5 | **Families policy rejection.** Child-directed apps face stricter review on data practices, ads and content rating. | 3 | 4 | 12 | No ad, attribution or analytics SDKs on child surfaces; correct target-age declaration; per-tenant privacy policy naming the right fiduciary; complete the Data Safety form from the field-justification record rather than from memory. | Mobile owner + Compliance |
| R-6 | **Fiduciary role in B2B is legally wrong.** If Brolly is the fiduciary rather than the processor in school tenants, the consent obligation moves to Brolly and the pilot's consent flow is insufficient. | 3 | 5 | 15 | Obtain a written opinion from an Indian data-protection lawyer before Gate 3. `fiduciary_role` is stored on the record precisely so the answer can change without a schema migration. | Founder |
| R-7 | **Team capacity.** Five developers, one content designer, three services, five app flavours, four role interfaces, compressed timeline. | 4 | 4 | 16 | Gated scope with an explicit "not in this gate" list; P0/P1/P2 enforced; §12 exclusions defended in writing. | Product |
| R-8 | **Content inventory uncertainty.** Internal records disagree on how much of the AI track is finished (§20.4 Q5), which changes ingestion effort and pilot class coverage. | 3 | 3 | 9 | Physical inventory of delivered PDFs and source HTML before Gate 1; publish the confirmed list as the ingestion backlog. | Content designer |
| R-9 | **CBSE publishes the 2027–28 compulsory Classes 9–10 syllabus mid-build**, changing the Class 9 mark map that the Class 9 content is built around. | 4 | 3 | 12 | Content is versioned and mapping metadata is structured, so a re-map is a content release rather than a code change. Monitor cbseacademic.nic.in; schedule a re-check each term. | Content designer |
| R-10 | **Pyodide first-load cost on low-end devices** makes practice feel slow, undermining the main product advantage. | 3 | 4 | 12 | Measure on the reference device before Gate 2, not after; aggressive caching; lazy-load beyond the first chapter; keep the hosted runtime as a documented fallback path. | Engineering lead |
| R-11 | **Student authentication is the activation bottleneck.** If children cannot log in on shared devices in a 40-minute period, nothing else matters. | 3 | 4 | 12 | Design for roster code plus school-issued credential; test with a real class before Gate 3; rate-limit per identifier rather than per device. | Product |
| R-12 | **Celery tenancy gap.** Background tasks are the classic place a multi-tenant system leaks; this is a known gap being closed deliberately. | 3 | 5 | 15 | `TenantTask` base class plus a CI check that fails on any task outside it. Not an afterthought; a Gate 1 item. | Engineering lead |
| R-13 | **Content correctness defects reach print or platform.** Countable claims, arithmetic and grid puzzles have previously been found wrong only on explicit verification. | 3 | 3 | 9 | Execution as a publish gate (FR-CH-06); independent verification of every countable claim; honest scoping of what was and was not proofread. | Content designer |
| R-14 | **Payer ambiguity in B2B stalls billing scope**, and a late decision for parent-pays forces a purchase surface into child-directed apps. | 4 | 3 | 12 | Decide before Gate 4. Default to school-pays. If parent-pays is required, run it on web under the Brolly brand and keep apps consumption-only. | Founder |
| R-15 | **DPDP enforcement arrives before readiness** (13 May 2027) with penalties up to substantial statutory maxima. | 2 | 5 | 10 | Compliance checklist tracked as a KPI with a 90-day red line; consent, retention, erasure and audit controls delivered by Gate 4. | Compliance owner |
| R-16 | **Schools do not use it.** The likeliest commercial failure is not a technical one; it is a timetabled period that quietly stops happening. | 3 | 5 | 15 | Teacher console designed for zero preparation; schedule drift as a weekly KPI with an escalation rule; a named account owner per pilot school. | Product |

### 19.2 The three risks to watch above all others

1. **R-1 (Play Console)** — because it is external, it cannot be compressed by working harder, and it gates a headline feature of the B2B proposition.
2. **R-7 (capacity)** — because the failure mode is not a missed deadline but five half-built surfaces, none of which can be demonstrated.
3. **R-16 (non-use)** — because every other risk in this register is visible in a dashboard, and this one looks exactly like success until renewal.

---

## 20. Assumptions

### 20.1 Business assumptions [A]

| ID | Assumption | Retired by |
|---|---|---|
| AS-B1 | The five pilot schools will supply rosters in a machine-readable form (CSV or export). | Confirmation from each school before Gate 2 |
| AS-B2 | Schools will run Brolly Juniors in an existing timetabled computer period rather than creating a new one. | Timetable confirmation per school |
| AS-B3 | School-pays is acceptable to at least four of the five pilot schools. | §20.4 Q4 |
| AS-B4 | Pilot pricing is per student per term. | Signed pilot agreements |
| AS-B5 | Renewal is decided at the end of the academic term, not the calendar year. | School contract terms |

### 20.2 Technical assumptions [A]

| ID | Assumption | Retired by |
|---|---|---|
| AS-T1 | Pilot concurrency stays within the capacity of the shared ECS deployment without an orchestration layer beyond ECS Fargate. | Load test before Gate 3 |
| AS-T2 | Pyodide meets NFR-PRF-03/04 on the reference device. | Measurement before Gate 2 (R-10) |
| AS-T3 | School network conditions permit initial runtime download during a lesson. | Site test at one pilot school |
| AS-T4 | Students have access to a device at a ratio of at least one per two students in the school lab. | School survey |
| AS-T5 | One shared deployment plus one isolated deployment covers all five schools. | §20.4 Q2 |
| AS-T6 | Existing textbook HTML is structured enough to ingest programmatically without a full rewrite. | Ingestion spike before Gate 1 |

### 20.3 Compliance assumptions [A]

| ID | Assumption | Retired by |
|---|---|---|
| AS-C1 | In B2B, the school is the data fiduciary and Brolly is a processor. | Legal opinion (R-6) |
| AS-C2 | In B2C, Brolly is the data fiduciary and the guardian is the consent grantor. | Legal opinion |
| AS-C3 | Consumption-only school apps avoid Play billing obligations. | Play review outcome |
| AS-C4 | Unlisted distribution is acceptable to the pilot schools for parent access. | School confirmation |

### 20.4 Open questions — these gate the full build spec [U]

| # | Question | Why it blocks | Needed by |
|---|---|---|---|
| **Q1** | **Play Console account type (organisation vs individual) and creation date.** | Longest external lead time on the critical path; determines whether five listings are feasible in the pilot window and what verification is required. | Immediately — before any other mobile work |
| **Q2** | **The precise wording of the data-separation requirement from the school that asked for it.** | Determines whether the isolated deployment class satisfies the contract or whether a different architecture and price are needed. Building to a guess risks either over-engineering or a broken commitment. | Before Gate 2 |
| **Q3** | **Year-two school and student targets.** | Sets capacity planning, infra cost ceilings (BO-7), the B2C target (BO-5) and whether the shared deployment needs a scaling plan in year one. | Before Gate 4 |
| **Q4** | **In B2B, does the school pay or the parent?** | Changes the billing entity, whether a payment surface is needed at all, whether it can live in a child-directed app, and the consent chain inside a school tenant. | Before Gate 4 |
| **Q5** | **Confirmed content inventory.** Two internal records disagree on how much of the AI track is complete. | Sets the ingestion backlog, the classes the pilot can actually serve, and the content designer's schedule. | Before Gate 1 |

Three further editorial decisions are outstanding on the textbook content and should be settled in the same pass, because the platform ingests that content: whether "no homework" at Class 6 tolerates an optional unmarked card; whether the Class 7 optional Python Track stays, is removed, or is reframed as a declared one-off; and whether the Class 7 Side Quest counts inside or on top of the 100 XP total. The last of these directly affects FR-LRN-06, since platform XP must agree with the book.

### 20.5 Superseded material — recorded to prevent contradiction

**RESOLVED in v2.0.** v1.0 recorded a contradiction between two internal records on the technology stack. The client brief settles it. The confirmed stack is:

| Layer | Confirmed |
|---|---|
| Web | Next.js · React · TypeScript |
| Mobile | React Native · Expo · TypeScript (EAS build profiles per school flavour) |
| Backend | FastAPI · Python |
| Database | PostgreSQL with RLS |
| Auth | JWT + RBAC |
| Cloud | AWS, ap-south-1 (Mumbai) for data residency |
| Storage / CDN | S3 + CloudFront |
| Containers / CI / Monitoring | Docker · GitHub Actions · CloudWatch |

Three positions from the locked architecture survive unchanged because the brief does not contradict them and they are load-bearing: **Pyodide** as the in-browser practice runtime, the **per-school flavour build** rather than one consumer app, and the **consumption-only** posture for school apps. The earlier reference to Django is withdrawn.

---

## 21. Constraints

### 21.1 Fixed constraints — cannot be traded

| ID | Constraint | Consequence for design |
|---|---|---|
| CN-1 | Every learner is legally a child in India (under 18). | No behavioural tracking, no targeted advertising, verifiable parental consent, guardian as B2C account holder. Not configurable. |
| CN-2 | DPDP full compliance by 13 May 2027. | Consent, retention, erasure and audit are Gate 3/4 items, not post-pilot work. |
| CN-3 | Data residency in the Mumbai region. | Constrains hosting, CDN and any sub-processor selection. |
| CN-4 | One school has contractually requested data separation. | The isolated deployment class exists; it is not an optional future. |
| CN-5 | Google Play Families policy and Repetitive Content policy apply. | Shapes app metadata, SDK selection, and the decision to go unlisted for the pilot. |
| CN-6 | Content correctness is a claim made to schools about CBSE alignment. | Execution and verification are publish gates; Brolly additions must be labelled as additions. |

### 21.2 Resource constraints

| ID | Constraint | Consequence |
|---|---|---|
| CN-7 | Five developers, one content designer. | Scope is gated; §12 exclusions are defended; no per-tenant custom work. |
| CN-8 | Compressed pilot timeline with five schools. | Sequencing follows the academic calendar; a slipped gate moves the pilot term, not the scope of a gate. |
| CN-9 | Budget ceiling not stated. | Infrastructure defaults to AWS managed services (ECS Fargate, RDS, S3, CloudFront) rather than self-managed Kubernetes; cost ceilings pending §20.4 Q3. |

### 21.3 Technical constraints

| ID | Constraint | Consequence |
|---|---|---|
| CN-10 | Shared database, shared schema, `tenant_id NOT NULL`; clone-per-school is reversed and settled. | No per-tenant schema, no per-tenant migration, no sync client. |
| CN-11 | Content carries no `tenant_id`. | Personalisation attaches to entitlement and schedule, never to content. Any request for per-school content edits is out of scope. |
| CN-12 | Global user, per-tenant membership. | Every screen must resolve and display an active tenant; no tenant-scoped user records. |
| CN-13 | Brolly Admin is a platform flag with audited impersonation. | No admin user seeded into tenants; no silent cross-tenant reads. |
| CN-14 | Two runtimes: Pyodide in-browser for practice, hosted service for graded submissions. | Grading correctness lives server-side; practice cost is near zero; the two must produce consistent results for the same programme. |
| CN-15 | One codebase, one commit, five signed AABs. | No per-school branches; branding is configuration. |
| CN-16 | AWS ECS Fargate, not EKS, for the pilot. | Deployment simplicity is prioritised over elasticity; revisit at year-two scale. |
| CN-17 | Existing HTML-to-PDF content pipeline must keep working. | Content Hub ingestion must not require abandoning the pipeline that produces the printed books. |

### 21.4 Constraint conflicts worth naming

- **CN-5 (Repetitive Content) versus the white-label proposition.** Five near-identical apps is exactly the pattern the policy targets. Resolved for the pilot by unlisted distribution plus real differentiation, but this constraint tightens as the number of schools grows, and at some school count a single multi-tenant Brolly app with school selection becomes the safer answer. That threshold should be reviewed at ten schools.
- **CN-1 (no behavioural tracking) versus product analytics.** Standard product instrumentation is unavailable on student surfaces. Learning metrics must be derived from the domain data the product already records — chapters, attempts, submissions — rather than from behavioural telemetry. This is a design constraint on §17, and it is why §17.5 lists metrics deliberately not collected.
- **CN-7 (team size) versus scope.** The honest position: the feature list in §11 is larger than five developers can build to full depth in a compressed pilot. §22.2 resolves this by gating, and each gate names what it does not include.

---

## 22. Future Roadmap

### 22.1 Roadmap principles

1. Gate before date. A gate ships when its exit criteria pass, and the pilot term moves rather than the criteria.
2. Every gate names what it does **not** include, so the exclusion is a decision rather than a slip.
3. Nothing that touches tenancy, consent or content correctness is deferred past the gate that first needs it, because all three are expensive to retrofit and one of them is a legal obligation.

### 22.2 Gated delivery plan (to pilot)

#### Gate 1 — Foundations
**Delivers:** tenancy model with `tenant_id` and forced RLS on a least-privilege role; tenant context middleware; `TenantTask`; isolation suite in CI; global user and membership; Brolly Admin flag; tenant provisioning; Content Hub models; ingestion of the confirmed content inventory; asset store.
**Exit:** AC-G-01, AC-G-02, AC-G-03 green. Tenant #1 and one school tenant provisioned by the same path. First chapter ingested and rendering.
**Not in this gate:** student experience, mobile, consent UI, reporting.
**Blocked by:** §20.4 Q5.

#### Gate 2 — Deliver a lesson
**Delivers:** classes, sections, roster import, teacher assignment, schedule; entitlement; chapter reader; CodeMirror editor; Pyodide practice runtime; progress; runtime branding; content versioning; impersonation console; audit logging; observability; isolated deployment class stood up.
**Exit:** a student in a school tenant reads a scheduled chapter and runs Python in the browser, on the reference device, within the §14.1 budgets. Two tenants schedule the same chapter differently.
**Not in this gate:** graded submission, quizzes, mobile apps, guardian accounts, reporting.
**Blocked by:** §20.4 Q2 for the isolated class.

#### Gate 3 — Assess, and put it in a school's hands
**Delivers:** Code Execution service; graded submissions; quiz engine; auto-grading with override; teacher console (today view, progress board, marking queue, multi-school switching); consent model and gating; guardian accounts for B2C; mobile flavour pipeline; five signed AABs; first Play listings, unlisted; backup restore test.
**Exit:** end-to-end lesson including a graded submission, in a school-branded app, on a real device, in a real classroom. AC-G-04 to AC-G-08 green.
**Not in this gate:** reporting dashboards, data export, practical-file tracker, offline mode.
**Blocked by:** §20.4 Q1 (Play Console), R-6 (legal opinion).

#### Gate 4 — Make it a business
**Delivers:** nightly rollups; School Admin adoption reporting; Brolly Admin cross-tenant dashboards from rollups; guardian progress view; tenant-scoped audit log view; data export and erasure workflow; verifiable parental consent path; Class 9 practical-file tracker; branded notifications; billing per the decided payer model.
**Exit:** each School Admin can answer the principal's question from the product. Compliance checklist closed. AC-G-09 to AC-G-12 green.
**Not in this gate:** offline mode, difficulty analytics, iOS.
**Blocked by:** §20.4 Q3 and Q4.

#### Gate 5 — Harden and prepare to scale
**Delivers:** external isolation penetration test; load test at year-two projected concurrency; offline-tolerant reading with queued submission; chapter difficulty analytics feeding content improvement; onboarding runbook proven at ≤8 hours per school; capacity plan for year two.
**Exit:** a sixth school onboarded by the runbook without engineering involvement.

### 22.3 Post-pilot horizons

**Horizon 1 (next two terms).** Class 10 content once CBSE publishes the compulsory Classes 9–10 syllabus, treated as a new book rather than an extension of Class 9. Teacher editions: mark schemes, lesson plans and worksheet packs, none of which exist today. iOS for schools that require it. School ERP import for the first school that makes it a condition. Review the single-multi-tenant-app-versus-many-flavours threshold at ten schools (§21.4).

**Horizon 2 (year two).** Adaptive practice sequencing driven by the attempt data the platform already holds, which needs no behavioural tracking. A content authoring interface for Brolly's own team, replacing HTML ingestion. Regional language support, triggered by the first non-English-medium school. Public Play listings once the first listing has survived review.

**Horizon 3 (speculative, explicitly not committed).** Classes 3–4 to match the full CBSE CT & AI range. An assessment bank sold separately to schools. A teacher-training product, given that supplied and trained teachers are already part of the B2B offer.

**Deliberately unscheduled:** any generative-AI tutor on a child surface. It is the most-requested feature in this category and the one this team is least equipped to make safe for 10-year-olds. It stays off the roadmap until there is a dedicated safety review, not a sprint.

### 22.4 Re-baseline triggers

Re-open this PRD when: CBSE publishes the 2027–28 Classes 9–10 syllabus; the DPDP rules on verifiable consent mechanisms change before enforcement; Play policy changes for child-directed or repetitive-content apps; the tenth school is signed; or any of the five open questions in §20.4 is answered in a way that contradicts an assumption in §20.

---

## Appendix A — Data Model Sketch

Indicative, not final. Column lists are partial. `T` marks a table carrying `tenant_id NOT NULL`.

```
GLOBAL CONTENT ZONE  (no tenant_id)
  Course(id, track, class_level, title, status)
  Chapter(id, course_id, sequence, title, cbse_mapping_json)
  Lesson(id, chapter_id, sequence, title)
  Block(id, lesson_id, sequence, type, payload)        type: prose|code|output|image|answer_box
  Exercise(id, lesson_id, kind, starter_code, assertions_json, xp)
  AnswerKey(id, exercise_id, solution, explanation, expected_output)
  Asset(id, kind, uri, checksum)
  ContentVersion(id, course_id, semver, published_at, immutable=true)

IDENTITY (global)
  User(id, email, phone, is_brolly_admin, status)
  Tenant(id, name, short_code, channel, deployment_class, status)
  Membership(id, user_id, tenant_id, role, status)                      T
  GuardianLink(id, guardian_user_id, student_user_id, tenant_id)        T

TENANT-SCOPED ORGANISATIONAL ZONE
  Branding(id, tenant_id, display_name, logo_asset, palette_json)       T
  Entitlement(id, tenant_id, course_id, content_version_id, valid_from, valid_to)   T
  Class(id, tenant_id, class_level, name)                               T
  Section(id, tenant_id, class_id, name)                                T
  SectionMember(id, tenant_id, section_id, user_id)                     T
  TeacherAssignment(id, tenant_id, section_id, user_id)                 T
  Schedule(id, tenant_id, section_id, chapter_id, release_at)           T
  Invite(id, tenant_id, email, role, token, expires_at)                 T

PERSON-SCOPED ACTIVITY ZONE
  Progress(id, tenant_id, user_id, chapter_id, state, xp, updated_at)   T
  Attempt(id, tenant_id, user_id, exercise_id, source, result, at)      T
  Submission(id, tenant_id, user_id, exercise_id, source, verdict, graded_by, at)  T
  Score(id, tenant_id, user_id, assessment_id, value, override_reason)  T
  Consent(id, tenant_id, subject_user_id, grantor_user_id, purpose,
          policy_version, fiduciary_role, granted_at, evidence_ref,
          withdrawn_at)                                                 T   append-only
  AuditEvent(id, tenant_id, actor_user_id, action, target, reason,
             source_ip, at)                                             T   append-only

ROLLUP ZONE  (derived, read by Brolly Admin)
  TenantDailyRollup(tenant_id, date, active_students, chapters_completed,
                    submissions, pass_rate)
```

**Constraint notes.** Every foreign key between two `T` tables must additionally enforce that both rows share the same `tenant_id` (NFR-DAT-02). References from tenant data into the content zone pin to a `ContentVersion`, never to a mutable content row (NFR-DAT-04).

---

## Appendix B — Tenant Isolation Pattern

The control of record, stated once so it is not reinvented per model.

1. Every tenant-owned table has `tenant_id NOT NULL` with a foreign key to `Tenant`.
2. Each such table has RLS enabled **and** `FORCE ROW LEVEL SECURITY`, so the table owner is not exempt.
3. The policy compares `tenant_id` against a value set on the session by the request or task.
4. The application connects as a dedicated role that is not a superuser and does not hold `BYPASSRLS`.
5. Web requests set the tenant context in middleware before any query. A request with no resolvable tenant is rejected rather than defaulted.
6. Background work sets it through `TenantTask`. A task outside `TenantTask` fails CI.
7. Cross-tenant work iterates tenants explicitly, one context at a time. There is no other permitted pattern.
8. CI asserts, per model, that a query under tenant A returns zero rows owned by tenant B, and that a newly added tenant-scoped model without a policy fails the build.

Application-level filtering remains in place as defence in depth. It is not the control of record, because application filtering fails open on the one query somebody forgot.

---

## Appendix C — Traceability Summary

| Business objective | Primary requirements | Primary metrics |
|---|---|---|
| BO-1 Pilot live | FR-TEN-07, FR-ENT-08, FR-BRD-01, FR-MOB-02 | Schools live; student activation |
| BO-2 Tenancy holds | FR-TEN-01…10, FR-AUD-01 | Cross-tenant incidents (0) |
| BO-3 Cheap school addition | FR-MOB-01, FR-BRD-01, NFR-SCL-02 | Engineering cost per new school |
| BO-4 Renewal | FR-TCH-01…05, FR-SAD-04 | Pilot conversion; schedule drift |
| BO-5 B2C line | FR-IAM-05, FR-CON-05, FR-ENT-07 | B2C paid learners (pending Q3) |
| BO-6 DPDP readiness | FR-CON-01…11, NFR-PRV-01…07 | Consent coverage; checklist closure |
| BO-7 Unit economics | FR-LRN-03, FR-CODE-05, NFR-SCL-01 | Infra cost per active student |
| BO-8 Content reuse | FR-CH-02…08 | Chapters ingested; content defects |

---

## Appendix D — Glossary

| Term | Meaning here |
|---|---|
| Tenant | An isolated customer boundary. One school = one tenant. B2C = Tenant #1. |
| Tenant #1 | The B2C tenant. Created by the same path as any school tenant. |
| Membership | The binding of a global user to a tenant with a role. The only way access is granted. |
| Deployment class | Shared, or conditionally isolated. Identical code, different data boundary. |
| Content Hub | The global, tenant-free curriculum service. |
| Entitlement | A tenant's right to a course at a content version. |
| Schedule | A tenant's mapping of chapters to dates for a class or section. |
| Flavour | One school's build of the mobile app, produced from the shared codebase. |
| Fiduciary role | Whether Brolly or the school is the data fiduciary for a given consent record. |
| Rollup | A nightly aggregate; the only cross-tenant read path. |
| CBSE / BOOST | Official syllabus content versus Brolly addition. The distinction must always be visible. |
| Practical file | The Class 9 AI 417 collection of numbered Python programmes, internally assessed. |

---

## Appendix E — Final Quality Check

Run against this document before it is treated as a baseline.

**Did it follow the brief?** All 22 requested sections are present and in order, plus five appendices. Both business models, all four listed roles, multi-tenancy with school-as-tenant and B2C as Tenant #1, white-label mobile apps, the Content Hub and the AI learning platform are all specified rather than mentioned.

**Did it avoid assumptions?** Every assumption is tagged [A], listed in §20 with the decision that retires it, and separated from confirmed facts [C] and unknowns [U]. The four known blockers are stated as blockers in §20.4, with a fifth (content inventory) added because it was found to be internally inconsistent.

**Did it identify missing information?** Yes — five open questions in §20.4, three editorial decisions on textbook content, one legal opinion (R-6), one superseded-document conflict (§20.5) and one contradiction in the content inventory (R-8).

**Is it specific and actionable?** Requirements carry IDs, priorities and testable wording. Acceptance criteria are Given/When/Then. Metrics carry definitions and thresholds. Gates carry exit criteria and explicit exclusions.

**Did it check for contradictions?** The v1.0 stack contradiction is resolved in v2.0 by the client brief and recorded in §20.5. A second contradiction remains open in the content inventory (§10.6, R-8). A date correction was applied: DPDP full compliance is 13 May 2027, per the notification of 13 November 2025.

**What this document does not do.** It does not size the market top-down, because no available figure would change a decision here. It does not set year-two capacity or cost ceilings, because the inputs do not exist. It does not specify the billing surface in detail, because the payer is undecided. Each of these is named rather than filled with a plausible number.
