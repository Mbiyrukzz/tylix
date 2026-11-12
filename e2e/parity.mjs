// Browser parity check for a scaffolded Tylix app with a hosted frontend.
// Every frontend (React today; Vue, Svelte and Angular later) must pass
// the same script, so the starters stay interchangeable.
//
//   node e2e/parity.mjs <baseUrl>                         full run, needs `tylix dev`
//   node e2e/parity.mjs <baseUrl> --existing email:pass   production run
//   add --ssr for apps with frontend.ssr on: also checks the raw HTML the
//   server sends (pages rendered with their data, statuses, redirects)
//
// The full run registers a new account and reads the verification and
// reset links from the dev mail log (/api/_tylix/mail-logs, /dev/mail),
// which only exist under `tylix dev`. The production run logs in with an
// account that is already verified and skips those steps.
//
// Uses playwright-core with a browser already on the machine. Set
// CHROMIUM_PATH if yours is somewhere else.
import fs from 'node:fs'
import { chromium } from 'playwright-core'

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '')
const existingArg = process.argv.indexOf('--existing')
const existing = existingArg > -1 ? process.argv[existingArg + 1].split(':') : null
const devMode = !existing
const ssr = process.argv.includes('--ssr')

// Raw server HTML for a page, as a browser navigation would get it, with
// the context's cookies (so the visitor's session) and no JavaScript.
async function rawPage(url, { maxRedirects = 0 } = {}) {
  const res = await page.request.get(`${base}${url}`, { headers: { Accept: 'text/html' }, maxRedirects })
  return { status: res.status(), location: res.headers().location, html: await res.text() }
}

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
const executablePath = CHROMIUM_CANDIDATES.find((p) => fs.existsSync(p))
if (!executablePath) {
  console.error('No Chromium found. Set CHROMIUM_PATH to a Chrome or Chromium binary.')
  process.exit(2)
}

const results = []
let failed = false
async function step(name, fn) {
  const started = Date.now()
  try {
    await fn()
    results.push(`  ✔ ${name} (${Date.now() - started}ms)`)
  } catch (err) {
    failed = true
    results.push(`  ✘ ${name}\n      ${String(err.message).split('\n').slice(0, 6).join('\n      ')}`)
    throw err
  }
}

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext()
const page = await context.newPage()

const problems = []
const watch = (p, label) => {
  p.on('pageerror', (err) => problems.push(`${label} page error: ${err.message}`))
  p.on('console', (msg) => {
    // Frameworks report hydration mismatches as warnings (Vue) or errors.
    if (msg.type() === 'warning' && /hydrat/i.test(msg.text())) {
      problems.push(`${label} hydration warning: ${msg.text()}`)
      return
    }
    if (msg.type() !== 'error') return
    // The browser itself logs every 4xx fetch. Several steps trigger one on
    // purpose (guest /api/me, bad login, duplicate register).
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(msg.text())) return
    problems.push(`${label} console error: ${msg.text()}`)
  })
}
watch(page, 'tab1')

const requests = []
context.on('request', (req) => requests.push(new URL(req.url()).pathname))
const countRequests = (path) => requests.filter((p) => p === path).length

const stamp = Date.now()
const email = existing ? existing[0] : `parity-${stamp}@example.com`
let password = existing ? existing[1] : 'Sup3r-secret!'
const name = 'Ada Lovelace'

async function fillRegister() {
  await page.goto(`${base}/register`)
  await page.fill('#name', name)
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.fill('#confirmPassword', password)
  await page.check('input[name="terms"]')
  await page.getByRole('button', { name: 'Create account' }).click()
}

async function logIn() {
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

// Finds the newest link of one kind sent to `email`, through the dev mail
// log page, so that page is exercised too.
async function linkFromDevMail(subject) {
  await page.goto(`${base}/dev/mail`)
  const mail = page.getByTestId('mail-log').locator('li', { hasText: email }).filter({ hasText: subject }).first()
  await mail.waitFor()
  return mail.getByRole('link').first().getAttribute('href')
}

try {
  await step('the server redirects a guest asking for /dashboard to /login?next=', async () => {
    const res = await page.request.get(`${base}/dashboard`, {
      headers: { Accept: 'text/html' },
      maxRedirects: 0,
    })
    if (res.status() !== 302) throw new Error(`expected 302, got ${res.status()}`)
    if (res.headers().location !== '/login?next=%2Fdashboard') {
      throw new Error(`unexpected Location: ${res.headers().location}`)
    }
  })

  await step('in the browser that lands on the login page, with no error shown', async () => {
    await page.goto(`${base}/dashboard`)
    await page.waitForURL(`${base}/login?next=%2Fdashboard`)
    await page.getByRole('heading', { name: 'Log in' }).waitFor()
    if (await page.getByRole('alert').count()) {
      throw new Error(`unexpected alert: ${await page.getByRole('alert').innerText()}`)
    }
  })

  if (ssr) {
    await step('SSR: guest pages arrive rendered, with no JavaScript', async () => {
      const login = await rawPage('/login')
      if (login.status !== 200 || !login.html.includes('Continue to your dashboard')) {
        throw new Error(`/login was not server-rendered (status ${login.status})`)
      }
      if (!login.html.includes('window.__TYLIX_SSR__=true')) throw new Error('no SSR marker in the page')
    })

    await step('SSR: an unknown URL answers with HTTP status 404', async () => {
      const missing = await rawPage('/does/not/exist')
      if (missing.status !== 404) throw new Error(`expected 404, got ${missing.status}`)
      if (!missing.html.includes('Page not found')) throw new Error('404 page not rendered')
    })
  }

  await step('an unknown URL renders the frontend 404 page', async () => {
    await page.goto(`${base}/does/not/exist`)
    await page.getByRole('heading', { name: 'Page not found' }).waitFor()
  })

  await step('client-side validation blocks a bad login', async () => {
    await page.goto(`${base}/login`)
    await page.getByRole('button', { name: 'Log in' }).click()
    await page.getByRole('alert').filter({ hasText: 'Enter a valid email address.' }).waitFor()
  })

  if (devMode) {
    await step('register creates an account and asks to verify email', async () => {
      await fillRegister()
      await page.getByTestId('registered').waitFor()
    })

    await step('registering the same email again shows the server error', async () => {
      await fillRegister()
      await page.getByRole('alert').filter({ hasText: 'This email is already registered.' }).waitFor()
    })

    await step('an unverified account cannot log in', async () => {
      await page.goto(`${base}/login`)
      await logIn()
      await page.getByRole('alert').filter({ hasText: /verify your email/i }).waitFor()
    })

    await step('the verification link from the dev mail log verifies the account', async () => {
      const link = await linkFromDevMail('Verify')
      await page.goto(`${base}${link}`)
      await page.getByRole('heading', { name: 'Email verified' }).waitFor()
    })
  } else {
    await step('the dev mail log does not exist in production', async () => {
      await page.goto(`${base}/dev/mail`)
      await page.getByRole('heading', { name: 'Page not found' }).waitFor()
      const res = await page.request.get(`${base}/api/_tylix/mail-logs`)
      if (res.status() !== 404) throw new Error(`mail log API answered ${res.status()}`)
    })
  }

  await step('a wrong password shows "Invalid email or password."', async () => {
    await page.goto(`${base}/login`)
    await page.fill('#email', email)
    await page.fill('#password', 'not-the-password')
    await page.getByRole('button', { name: 'Log in' }).click()
    await page.getByRole('alert').filter({ hasText: 'Invalid email or password.' }).waitFor()
  })

  await step('logging in from ?next= returns to the page that was asked for', async () => {
    await page.goto(`${base}/login?next=${encodeURIComponent('/dashboard?from=next')}`)
    await logIn()
    await page.waitForURL(`${base}/dashboard?from=next`)
    await page.getByTestId('dashboard-name').waitFor()
  })

  await step('?next= cannot send the user to another site', async () => {
    await page.goto(`${base}/login?next=${encodeURIComponent('//evil.example/steal')}`)
    await page.waitForURL(`${base}/dashboard`)
  })

  await step('page loads carry the session, so /api/me is not fetched', async () => {
    const before = countRequests('/api/me')
    const res = await page.goto(`${base}/dashboard`)
    if (!(await res.text()).includes('window.__TYLIX_SESSION__')) throw new Error('session not injected into the HTML')
    await page.getByTestId('dashboard-name').waitFor()
    if (countRequests('/api/me') !== before) throw new Error('/api/me was still requested')
  })

  const title = `Parity post ${stamp}`
  await step('creating a post through the protected API shows it in the list', async () => {
    await page.fill('input[name="title"]', title)
    await page.fill('textarea[name="body"]', 'Posted by the parity test.')
    await page.getByRole('button', { name: 'Publish post' }).click()
    await page.getByTestId('posts').getByText(title).waitFor()
  })

  if (ssr) {
    await step('SSR: the dashboard arrives with the user and their private posts', async () => {
      const dashboard = await rawPage('/dashboard')
      if (dashboard.status !== 200) throw new Error(`status ${dashboard.status}`)
      for (const expected of [name, title]) {
        if (!existing || expected === title) {
          if (!dashboard.html.includes(expected)) throw new Error(`"${expected}" missing from the server HTML`)
        }
      }
    })

    await step('SSR: public posts are in the HTML, and hydration does not refetch them', async () => {
      const posts = await rawPage('/posts')
      if (!posts.html.includes(title)) throw new Error('post title missing from the server HTML')
      const before = countRequests('/api/public/posts')
      await page.goto(`${base}/posts`)
      await page.getByTestId('public-posts').getByText(title).waitFor()
      await page.waitForLoadState('networkidle')
      if (countRequests('/api/public/posts') !== before) throw new Error('the browser fetched the posts again')
    })

    await step('SSR: a logged-in user asking for /login gets a server redirect', async () => {
      const login = await rawPage('/login')
      if (login.status !== 302 || login.location !== '/dashboard') {
        throw new Error(`expected 302 to /dashboard, got ${login.status} ${login.location ?? ''}`)
      }
    })
  }

  await step('the post appears on the public posts pages', async () => {
    await page.goto(`${base}/posts`)
    await page.getByTestId('public-posts').getByText(title).click()
    await page.getByTestId('post-title').filter({ hasText: title }).waitFor()
    if (!/\/posts\/\d+$/.test(page.url())) throw new Error(`unexpected URL ${page.url()}`)
  })

  await step('an expired access token is refreshed silently', async () => {
    const before = countRequests('/api/auth/refresh')
    await context.clearCookies({ name: 'tylix_access_token' })
    // With no access cookie the server can't inject the session, and
    // /dashboard is protected, so this goes through login?next=, where the
    // refresh succeeds and the user is sent straight back.
    await page.goto(`${base}/dashboard`)
    await page.waitForURL(`${base}/dashboard`)
    await page.getByTestId('posts').getByText(title).waitFor()
    if (countRequests('/api/auth/refresh') <= before) throw new Error('no /api/auth/refresh request was made')
    if (!(await context.cookies()).some((c) => c.name === 'tylix_access_token')) throw new Error('no new access cookie')
  })

  await step('tokens stay httpOnly: page JavaScript cannot read them', async () => {
    const visible = await page.evaluate(() => document.cookie)
    if (/tylix_(access|refresh)_token/.test(visible)) throw new Error(`document.cookie exposed: ${visible}`)
  })

  await step('deleting the post removes it', async () => {
    const item = page.getByTestId('posts').locator('li', { hasText: title })
    await item.getByRole('button', { name: 'Delete' }).click()
    await item.waitFor({ state: 'detached' })
  })

  const tab2 = await context.newPage()
  watch(tab2, 'tab2')
  await step('logging out in one tab logs out the other tab', async () => {
    await tab2.goto(`${base}/dashboard`)
    await tab2.getByTestId('dashboard-name').waitFor()
    await page.getByTestId('logout').click()
    await page.waitForURL(`${base}/`)
    await tab2.waitForURL(/\/login(\?|$)/, { timeout: 5000 })
  })

  await step('after logout the protected API answers 401', async () => {
    const res = await page.request.get(`${base}/api/posts`)
    if (res.status() !== 401) throw new Error(`expected 401, got ${res.status()}`)
  })

  if (devMode) {
    await step('forgot password sends a reset link', async () => {
      await page.goto(`${base}/login`)
      await page.getByRole('link', { name: 'Forgot password?' }).click()
      await page.fill('#email', email)
      await page.getByRole('button', { name: 'Send reset link' }).click()
      await page.getByTestId('reset-sent').waitFor()
    })

    await step('the reset link sets a new password that works for login', async () => {
      const link = await linkFromDevMail('Reset')
      await page.goto(`${base}${link}`)
      const newPassword = 'An0ther-secret!'
      await page.fill('#password', newPassword)
      await page.fill('#confirmPassword', newPassword)
      await page.getByRole('button', { name: 'Update password' }).click()
      await page.getByTestId('reset-done').waitFor()

      await page.goto(`${base}/login`)
      await logIn() // old password
      await page.getByRole('alert').filter({ hasText: 'Invalid email or password.' }).waitFor()
      password = newPassword
      await logIn()
      await page.waitForURL(`${base}/dashboard`)
    })

    await step('a reset link can only be used once', async () => {
      const link = await linkFromDevMail('Reset')
      await page.goto(`${base}${link}`)
      await page.fill('#password', 'Yet-an0ther-one!')
      await page.fill('#confirmPassword', 'Yet-an0ther-one!')
      await page.getByRole('button', { name: 'Update password' }).click()
      await page.getByRole('alert').filter({ hasText: 'Invalid or expired reset link.' }).waitFor()
    })
  }

  await step('no unexpected browser errors', async () => {
    if (problems.length) throw new Error(problems.join('\n'))
  })
} catch {
  // reported below
} finally {
  await browser.close()
  console.log(`Parity check against ${base} (${devMode ? 'dev' : 'production'}${ssr ? ', SSR' : ''})`)
  console.log(results.join('\n'))
  if (problems.length && !results.some((r) => r.includes('browser errors'))) console.log(problems.join('\n'))
  console.log(failed ? '\nFAILED' : `\nALL ${results.length} CHECKS PASSED`)
  if (devMode) console.log(`account: ${email}:${password}`)
  process.exitCode = failed ? 1 : 0
}
