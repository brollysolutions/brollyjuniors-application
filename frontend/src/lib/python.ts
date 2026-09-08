'use client'

/**
 * Python, in the browser.
 *
 * Pyodide runs in the student's own tab: nothing untrusted reaches our servers,
 * it costs nothing per run, and a school laptop with a poor connection still
 * gets an instant result. The server independently re-checks the source rules
 * ("must use a loop", "do not use sum()") so those cannot be faked from here.
 * Output-matching is trusted from the client — decision D7, and the reason a
 * server-side sandbox is the hardening step before these scores carry weight.
 */

const PYODIDE_VERSION = '0.26.4'
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

type Pyodide = any
let loading: Promise<Pyodide> | null = null

export type RunResult = { stdout: string; stderr: string; ok: boolean }

export function pythonState(): 'idle' | 'loading' | 'ready' {
  return loading ? (readyPyodide ? 'ready' : 'loading') : 'idle'
}
let readyPyodide: Pyodide | null = null

export async function loadPython(): Promise<Pyodide> {
  if (!loading) {
    loading = (async () => {
      await new Promise<void>((resolve, reject) => {
        if ((globalThis as any).loadPyodide) return resolve()
        const s = document.createElement('script')
        s.src = PYODIDE_URL + 'pyodide.js'
        s.onload = () => resolve()
        s.onerror = () => reject(new Error('Could not load the Python runtime. Check your connection.'))
        document.head.appendChild(s)
      })
      const py = await (globalThis as any).loadPyodide({ indexURL: PYODIDE_URL })
      readyPyodide = py
      return py
    })()
  }
  return loading
}

/** Run once, with the given lines already queued on stdin. */
export async function runPython(code: string, stdin = ''): Promise<RunResult> {
  const py = await loadPython()
  const lines = stdin ? stdin.split('\n') : []
  let out = ''
  let err = ''

  py.setStdin({ stdin: () => (lines.length ? lines.shift()! : '') })
  py.setStdout({ batched: (s: string) => { out += s + '\n' } })
  py.setStderr({ batched: (s: string) => { err += s + '\n' } })

  try {
    await py.runPythonAsync(code)
    return { stdout: out, stderr: err, ok: true }
  } catch (e: any) {
    // Python tracebacks are long and the interesting line is the last one; a
    // 13-year-old needs the error, not the interpreter's stack.
    const raw = String(e?.message ?? e)
    const lastLine = raw.trim().split('\n').filter(Boolean).pop() ?? raw
    return { stdout: out, stderr: (err + lastLine).trim(), ok: false }
  } finally {
    py.setStdin({ stdin: () => '' })
  }
}

/**
 * Run the code once per declared test case and collect the stdout of each, so
 * the server can compare them against what the task expects.
 */
export async function runTests(code: string, tests: Array<{ name: string; stdin?: string }>) {
  const outputs: Record<string, string> = {}
  let firstError = ''
  let plain = ''

  if (!tests.length) {
    const r = await runPython(code)
    return { outputs, stdout: r.stdout, stderr: r.stderr }
  }

  for (const t of tests) {
    const r = await runPython(code, t.stdin ?? '')
    outputs[t.name] = r.stdout
    if (!plain) plain = r.stdout
    if (!r.ok && !firstError) firstError = r.stderr
  }
  return { outputs, stdout: plain, stderr: firstError }
}
