# Frontend conventions — mobile first, without exception

Most students meet this product on a phone, and the same bundle is wrapped by
Capacitor as the iOS and Android app. The rules below are not style
preferences; they are the difference between a screen working on a phone and
not. Every one of them exists because the opposite shipped at least once.

`src/app/globals.css` is a design system, not a pile of rules. Read its section
headers before adding to it.

---

## The rules

**1. Every rule outside a media query is the phone rule, and every media query
is `min-width`.** Design the 320px case, then add width. The single deliberate
exception is the `max-width: 767px` block in §6 that turns tables into cards,
and it is commented as such.

**2. Never put layout in a `style` prop.** An inline
`style={{ gridTemplateColumns: … }}` or `style={{ width: 180 }}` outranks every
media query in the stylesheet, so the element quietly stops being responsive.
Both have shipped here and both had to be undone. Layout goes in a class.

**3. Use the scale.** Spacing `--s1 … --s16` (4 8 12 16 24 32 48 64), type
`--fs-2xs … --fs-4xl` (fluid, already clamped), radius `--r-xs … --r-pill`,
elevation `--e1 … --e3`, page gutter `--gutter`. If you are typing a raw pixel
value, you are probably adding a 41st one-off to a system that has none.

**4. 44px is the floor for anything tappable** — `min-height: var(--tap)`. That
includes a `<select>` dropped into a table cell, and a 6px progress track: give
the track a 44px button around it and give the height back with a negative
margin, as `.pbar .scrub` does.

**5. Never set `font-size` on a form control.** Controls are styled at the
element level — 16px on phones, `--fs-sm` from 768px. Below 16px, iOS Safari
zooms the page when the field takes focus and does not zoom back out.

**6. Full height is `100dvh`, not `100vh`,** and anything fixed to an edge
accounts for `env(safe-area-inset-*)` via the `--safe-t/r/b/l` tokens. `100vh`
on a phone is the height with the address bar retracted, so the last row sits
underneath it.

**7. Long strings get `.break`.** Emails, certificate serials, payment
provider references and URLs are the usual culprits for pushing a card past the
edge of the viewport.

---

## Reach for the primitive, don't rebuild it

From `src/components/ui.tsx`:

| Instead of | Use | Why |
| --- | --- | --- |
| a hand-built `<table>` | `<Table head={[…]}>` | copies each `<th>` onto its cells as `data-label`, which is what lets the table become one card per row below 768px |
| a hand-built dialog | `<Modal>` | bottom sheet on a phone, centred dialog from 640px; scroll lock, focus restore, Escape, `role="dialog"` |
| `<label>` + `<input>` | `<Field>` | wires the id, the help text, the error and `aria-invalid` to the control |
| a raw `<button>` for an async action | `<Action>` | busy state, cannot double-fire, never a submit button |
| `window.matchMedia` in a component | `useMedia` | one definition of each breakpoint on the JS side, matching the CSS |
| a decorative `▤` `★` `☰` | `<Glyph>` | hidden from screen readers |

Layout classes: `.grid` with `.g2` / `.g3` / `.g4` for card grids, `.split2`
for a wide column beside a narrow one (single column until 1024px),
`.split2.buyfirst` when the narrow column should come first on a phone,
`.fieldpair` for two fields that stack, `.filters` for a tab strip that scrolls
edge to edge on a phone and wraps on a laptop.

## The shell

| Width | Navigation |
| --- | --- |
| < 768px | Off-canvas drawer, plus a bottom bar of four destinations and **More** |
| 768–1023px | 78px icon rail, expandable from the top bar |
| ≥ 1024px | Full sidebar, open by default |

A new nav entry needs a short label in `TAB_LABEL` in `App.tsx` — "Browse
courses" does not fit a 70px tab.

---

## Before you ship a UI change

```bash
npm run dev                # in frontend/
npm run audit:responsive   # in another shell
```

The audit drives headless Chrome through every screen at 320, 375, 390, 414,
768, 1024 and 1440px and fails on four things a code review cannot see:

1. the document wider than the viewport
2. a painted box past the right edge, outside any declared scroller
3. an interactive control smaller than 44×44
4. leaf text clipped by an `overflow: hidden` box with no ellipsis

It exits non-zero, so it can gate a merge. A full run is 52 screens at seven
widths and takes roughly half an hour, so narrow it while you are iterating:

```bash
ROUTES=teacher npm run audit:responsive               # one portal
WIDTHS=320,768 npm run audit:responsive               # one pass
ROUTES=student STOPS=exercise npm run audit:responsive  # one screen
BASE=http://localhost:3100 npm run audit:responsive   # a different port
CHROME=/usr/bin/chromium npm run audit:responsive     # a specific browser
```

Each stop gets one retry from a clean load before it is reported, so a cold API
or a busy machine does not turn a passing screen into a red build.

A screen can only be covered if the seed data reaches it. The shared library
seeds no rows, so the admin Edit sheet and its delete confirmation have no stop
— they would fail on a fresh database rather than report a real break. Seed a
resource and they can be added. Anything you add that only appears with data is
worth seeding for the same reason: an unreachable screen is an unaudited one.

Use `localhost`, not `127.0.0.1` — the Next dev server blocks cross-origin dev
resources, and the app then never finishes booting.

**Adding a screen means adding a stop to `scripts/responsive-routes.mjs`.**
That is the whole maintenance burden, and it is what keeps the guarantee true
as the product grows. A stop that can no longer reach its screen is reported
separately from a layout finding, so a renamed button shows up as a stale route
rather than a false pass.

Emulation is not a handset. The audit catches everything above, but the `dvh`,
safe-area and 16px-input rules exist for bugs only a real iOS or Android device
shows — give a genuinely new surface a pass on a phone too.
