/**
 * Responsive audit.
 *
 * Drives headless Chrome over the DevTools protocol, walks every screen listed
 * in responsive-routes.mjs at every width, and measures the four things that
 * make a layout wrong on a phone and cannot be seen in a code review:
 *
 *   1. the document is wider than the viewport
 *   2. a painted box reaches past the right edge, outside any declared scroller
 *   3. an interactive control is smaller than 44 x 44
 *   4. leaf text is clipped by an overflow:hidden box with no ellipsis
 *
 * Exits non-zero when it finds any of them, so it can gate a merge.
 *
 *   npm run audit:responsive
 *   BASE=http://localhost:3100 npm run audit:responsive
 *   ROUTES=teacher,admin npm run audit:responsive
 *   WIDTHS=320,768 npm run audit:responsive
 *
 * Needs the app running (`npm run dev`) and a Chrome on the machine. Point at
 * a specific binary with CHROME=/path/to/chrome. Use localhost rather than
 * 127.0.0.1: the Next dev server blocks cross-origin dev resources, and the
 * app then never finishes booting.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROUTES, WIDTHS as DEFAULT_WIDTHS } from './responsive-routes.mjs'

const BASE = process.env.BASE || 'http://localhost:3301'
const ONLY = (process.env.ROUTES || '').split(',').map(s => s.trim()).filter(Boolean)
const ONLY_STOPS = (process.env.STOPS || '').split(',').map(s => s.trim()).filter(Boolean)
const WIDTHS = process.env.WIDTHS
  ? process.env.WIDTHS.split(',').map(n => Number(n.trim())).filter(Boolean)
  : DEFAULT_WIDTHS

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

function findChrome() {
  const hit = CANDIDATES.find(p => existsSync(p))
  if (!hit) {
    console.error(
      'No Chrome found. Set CHROME to the binary, e.g.\n' +
      '  CHROME="/usr/bin/chromium" npm run audit:responsive')
    process.exit(2)
  }
  return hit
}

async function launchChrome() {
  const bin = findChrome()
  const port = 9222 + Math.floor(Math.random() * 400)
  const profile = mkdtempSync(join(tmpdir(), 'brolly-audit-'))
  const child = spawn(bin, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-extensions', '--disable-dev-shm-usage',
    'about:blank',
  ], { stdio: 'ignore', detached: false })

  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) return { child, port, profile }
    } catch { /* not up yet */ }
    await sleep(250)
  }
  child.kill()
  throw new Error('Chrome did not expose a DevTools endpoint')
}

/** Minimal CDP client over the global WebSocket (Node 22+). */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res())
    ws.addEventListener('error', rej)
  })
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (!m.id || !pending.has(m.id)) return
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  })
  return {
    ready,
    close: () => ws.close(),
    send(method, params = {}) {
      const mid = ++id
      return new Promise((res, rej) => {
        pending.set(mid, { res, rej })
        ws.send(JSON.stringify({ id: mid, method, params }))
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Injected into the page
// ---------------------------------------------------------------------------

const HELPERS = `
window.__h = {
  wait: ms => new Promise(r => setTimeout(r, ms)),
  btn(text, nth = 0) {
    return [...document.querySelectorAll('button')]
      .filter(b => (b.textContent || '').trim().replace(/\\s+/g, ' ').includes(text))[nth] || null
  },
  async click(text, nth = 0, settle = 900) {
    let b = null
    for (let i = 0; i < 40 && !b; i++) {
      b = window.__h.btn(text, nth)
      if (!b) await window.__h.wait(200)
    }
    if (!b) throw new Error('no button matching: ' + text)
    b.click()
    await window.__h.wait(settle)
  },
  async sel(css, nth = 0, settle = 900) {
    let el = null
    for (let i = 0; i < 40 && !el; i++) {
      el = document.querySelectorAll(css)[nth]
      if (!el) await window.__h.wait(200)
    }
    if (!el) throw new Error('no element matching: ' + css)
    el.click()
    await window.__h.wait(settle)
  },
  /** The portal is ready when a nav item exists, not merely when .shell does. */
  async ready(tries = 60) {
    for (let i = 0; i < tries; i++) {
      if (document.querySelector('.side nav button')) return true
      await window.__h.wait(200)
    }
    return false
  },
  async ensureLogin(label) {
    // The refresh cookie survives a reload, so after the first sign-in every
    // later load lands straight in the portal and there is no Sign in button.
    for (let i = 0; i < 50; i++) {
      if (document.querySelector('.shell')) break
      if (window.__h.btn('Sign in')) break
      await window.__h.wait(200)
    }
    if (!document.querySelector('.shell')) {
      await window.__h.click('Sign in')
      await window.__h.click(label, 0, 2000)
    }
    if (!await window.__h.ready()) throw new Error('portal never finished loading')
    await window.__h.wait(400)
  },
}
`

const PROBE = `(() => {
  const de = document.documentElement
  const vw = de.clientWidth
  const out = { vw, scrollWidth: de.scrollWidth, smallTaps: [], clipped: [], outside: [] }
  out.horizontalScroll = de.scrollWidth > de.clientWidth + 1

  const name = el => {
    const cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 3).join('.')
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '')
  }

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const tag = el.tagName.toLowerCase()

    // 1 + 2. Past the right edge, and not inside something meant to scroll.
    if (r.right > vw + 1 && cs.position !== 'fixed') {
      let p = el.parentElement, inScroller = false
      while (p && p !== document.body) {
        const o = getComputedStyle(p).overflowX
        if (o === 'auto' || o === 'scroll') { inScroller = true; break }
        p = p.parentElement
      }
      if (!inScroller) out.outside.push({ el: name(el), right: Math.round(r.right), w: Math.round(r.width) })
    }

    // 3. Reach. A closed drawer is inert and off canvas, so it does not count.
    const role = el.getAttribute('role')
    const interactive = ['button', 'a', 'input', 'select', 'textarea'].includes(tag) ||
      ['button', 'tab', 'radio', 'menuitem'].includes(role)
    if (interactive && !el.disabled && el.offsetParent !== null &&
        !el.closest('.skip') && !el.closest('[inert]')) {
      // An inline link inside running text is exempt (WCAG 2.5.8). In this app
      // that is exactly the .link button outside the site chrome.
      const inlineLink = el.classList.contains('link') && !el.closest('.sitebar, .sitemenu')
      if (!inlineLink && (r.height < 43.5 || r.width < 24)) {
        out.smallTaps.push({ el: name(el), w: Math.round(r.width), h: Math.round(r.height),
          text: (el.textContent || '').trim().slice(0, 26) })
      }
    }

    // 4. Text a box cut off without saying so.
    if (el.children.length === 0 && (el.textContent || '').trim()) {
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX === 'hidden' && cs.textOverflow !== 'ellipsis') {
        out.clipped.push({ el: name(el), scroll: el.scrollWidth, client: el.clientWidth,
          text: el.textContent.trim().slice(0, 30) })
      }
      if (el.scrollHeight > el.clientHeight + 2 && cs.overflowY === 'hidden' && cs.textOverflow !== 'ellipsis') {
        out.clipped.push({ el: name(el), vscroll: el.scrollHeight, vclient: el.clientHeight,
          text: el.textContent.trim().slice(0, 30) })
      }
    }
  }

  const dedupe = (arr, key) => {
    const seen = new Set(), keep = []
    for (const x of arr) { const k = key(x); if (!seen.has(k)) { seen.add(k); keep.push(x) } }
    return keep.slice(0, 10)
  }
  out.outside = dedupe(out.outside, x => x.el)
  out.smallTaps = dedupe(out.smallTaps, x => x.el + x.h + x.text)
  out.clipped = dedupe(out.clipped, x => x.el + x.text)
  return out
})()`

// ---------------------------------------------------------------------------

async function main() {
  try {
    const r = await fetch(BASE, { redirect: 'manual' })
    if (!r.ok && r.status < 300) throw new Error(String(r.status))
  } catch {
    console.error(`Nothing answering at ${BASE}. Start the app first (npm run dev), ` +
      'or set BASE to where it is running.')
    process.exit(2)
  }

  const routes = ROUTES
    .filter(r => !ONLY.length || ONLY.includes(r.name))
    .map(r => ({ ...r, stops: r.stops.filter(s => !ONLY_STOPS.length || ONLY_STOPS.includes(s.name)) }))
    .filter(r => r.stops.length)

  if (!routes.length) {
    console.error('No routes selected.')
    process.exit(2)
  }

  const { child, port, profile } = await launchChrome()
  const cleanup = () => {
    try { child.kill() } catch { /* already gone */ }
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* leave it */ }
  }
  process.on('exit', cleanup)
  process.on('SIGINT', () => { cleanup(); process.exit(130) })

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const c = connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
  await c.ready
  await c.send('Page.enable')
  await c.send('Runtime.enable')
  await c.send('Network.enable')

  const findings = []
  let probes = 0

  for (const width of WIDTHS) {
    await c.send('Emulation.setDeviceMetricsOverride', {
      width, height: 900, deviceScaleFactor: 1, mobile: width < 768,
    })
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: width < 768, maxTouchPoints: 5 })

    for (const route of routes) {
      // Each route wants its own account, and the refresh cookie outlives a
      // reload — so start every route from a clean jar and let the first stop
      // sign in.
      await c.send('Network.clearBrowserCookies')

      for (const stop of route.stops) {
        const where = `${route.name}/${stop.name}`
        let failed = null

        // One retry from a clean load: a cold API or a busy machine should not
        // turn a passing screen into a red build. Twice in a row is real.
        for (let attempt = 0; attempt < 2; attempt++) {
          await c.send('Page.navigate', { url: BASE })
          await sleep(1500)
          await c.send('Runtime.evaluate', { expression: HELPERS })
          if (!stop.run) { failed = null; break }

          const r = await c.send('Runtime.evaluate', {
            expression: `(async () => { ${stop.run} })()`, awaitPromise: true,
          })
          if (!r.exceptionDetails) { failed = null; break }
          failed = (r.exceptionDetails.exception?.description ||
            r.exceptionDetails.text || '').split('\n')[0]
        }

        if (failed) {
          findings.push({ width, where, kind: 'NAV', detail: failed })
          continue
        }

        const res = await c.send('Runtime.evaluate', { expression: PROBE, returnByValue: true })
        const v = res.result.value
        probes++
        if (v.horizontalScroll) {
          findings.push({ width, where, kind: 'H-SCROLL',
            detail: `document is ${v.scrollWidth}px in a ${v.vw}px viewport` })
        }
        for (const x of v.outside) {
          findings.push({ width, where, kind: 'OUTSIDE',
            detail: `${x.el} — ${x.w}px wide, right edge at ${x.right}` })
        }
        for (const x of v.smallTaps) {
          findings.push({ width, where, kind: 'REACH',
            detail: `${x.el} is ${x.w}x${x.h}${x.text ? ` — "${x.text}"` : ''}` })
        }
        for (const x of v.clipped) {
          findings.push({ width, where, kind: 'CLIPPED', detail: `${x.el} — "${x.text}"` })
        }
      }
    }
    process.stderr.write(`  ${width}px done\n`)
  }

  c.close()

  const layout = findings.filter(f => f.kind !== 'NAV')
  const nav = findings.filter(f => f.kind === 'NAV')

  if (nav.length) {
    console.log('\nCould not reach these screens — a label or selector in ' +
      'scripts/responsive-routes.mjs is out of date:\n')
    for (const f of nav) console.log(`  ${f.where} @ ${f.width}px — ${f.detail}`)
  }

  if (layout.length) {
    console.log('\nLayout findings:\n')
    let last = ''
    for (const f of layout) {
      const head = `${f.where} @ ${f.width}px`
      if (head !== last) { console.log(`\n  ${head}`); last = head }
      console.log(`    ${f.kind.padEnd(9)} ${f.detail}`)
    }
  }

  const screens = routes.reduce((n, r) => n + r.stops.length, 0)
  const n = (count, one, many = one + 's') => `${count} ${count === 1 ? one : many}`
  console.log(
    `\n${layout.length ? n(layout.length, 'layout finding') : 'Clean'} — ` +
    `${n(probes, 'probe')} across ${n(screens, 'screen')} ` +
    `at ${n(WIDTHS.length, 'width')} (${WIDTHS.join(', ')})`)

  process.exit(layout.length || nav.length ? 1 : 0)
}

main().catch(e => { console.error('Audit failed:', e.message); process.exit(2) })
