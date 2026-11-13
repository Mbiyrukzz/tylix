// Drives the real panel (dist/panel.html) against a live `tylix dev`
// app. The chrome.devtools API is stubbed so inspectedWindow.eval runs
// in a second page that has the app open, which is what the browser
// does for a real DevTools panel.
//
//   TYLIX_DEVTOOLS_APP=http://localhost:3000 npm test
//
// Needs a native (.tyx) starter app running under `tylix dev` with its
// /posts page; skipped when TYLIX_DEVTOOLS_APP is not set.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launchBrowser, waitFor } from '../../../e2e/lib/browser.mjs'

const APP = process.env.TYLIX_DEVTOOLS_APP
const PANEL = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'panel.html'),
).href

test('devtools panel', { skip: !APP && 'set TYLIX_DEVTOOLS_APP to a running tylix dev app' }, async () => {
  const browser = await launchBrowser()
  try {
    const context = await browser.newContext()
    const app = await context.newPage()
    await app.goto(`${APP}/posts`)
    await app.waitForLoadState('networkidle')

    const panel = await context.newPage()
    await panel.exposeFunction('__evalInApp', async (expression) => {
      try {
        return [await app.evaluate(expression), null]
      } catch (err) {
        return [undefined, { isException: true, value: String(err.message) }]
      }
    })
    await panel.addInitScript(() => {
      window.chrome = {
        devtools: {
          panels: { themeName: 'dark' },
          inspectedWindow: {
            eval(expression, cb) {
              window.__evalInApp(expression).then(([result, exc]) => cb(result, exc ?? undefined))
            },
          },
          network: { onNavigated: { addListener() {} } },
        },
      }
    })
    await panel.goto(PANEL)

    const rows = () => panel.locator('#instances .row .name').allTextContents()

    // 1. the tree: layout, page and its components; capabilities
    await waitFor(async () => (await rows()).includes('PostsIndex'), { what: 'page in tree' })
    const names = await rows()
    assert.ok(names.includes('Layout'), names.join(','))
    assert.ok(names.some((n) => n === '<SiteNavbar>'), names.join(','))
    const caps = await panel.locator('#capabilities .row .name').allTextContents()
    assert.ok(caps.includes('Auth') && caps.includes('Theme'), caps.join(','))

    // 2. hovering a row highlights the component in the page
    await panel.locator('#instances .row', { hasText: '<SiteNavbar>' }).first().hover()
    await waitFor(
      async () => app.evaluate(() => document.querySelector('[data-tylix-devtools]')?.style.display === ''),
      { what: 'highlight overlay' },
    )

    // 3. selecting the page shows its state; editing it re-renders the app
    await panel.locator('#instances .row', { hasText: 'PostsIndex' }).click()
    await waitFor(async () => (await panel.locator('#details h1').textContent()) === 'PostsIndex', { what: 'details' })
    const queryRow = panel.locator('.fields li', { has: panel.locator('.key', { hasText: /^query:$/ }) })
    await queryRow.hover()
    await queryRow.locator('button.edit').click()
    await queryRow.locator('textarea').fill('"zzz-no-match"')
    await queryRow.getByRole('button', { name: 'Save' }).click()
    await waitFor(
      async () => (await app.textContent('body')).includes('No posts match your search.'),
      { what: 'app re-rendered after edit' },
    )
    // the details pane follows the change
    await waitFor(async () => (await queryRow.textContent()).includes('zzz-no-match'), { what: 'details updated' })

    // 4. bad JSON is refused with a message, nothing is written
    await queryRow.hover()
    await queryRow.locator('button.edit').click()
    await queryRow.locator('textarea').fill('not json')
    await queryRow.getByRole('button', { name: 'Save' }).click()
    await waitFor(async () => /Not valid JSON/.test(await queryRow.locator('.error').textContent()), { what: 'json error' })
    await queryRow.getByRole('button', { name: 'Cancel' }).click()

    // 5. a state change made by the app itself shows up in the panel
    await app.fill('input[type="search"]', 'typed in the app')
    await waitFor(async () => (await queryRow.textContent()).includes('typed in the app'), { what: 'live update' })

    // 6. running an action with arguments
    const action = panel.locator('.action-row', { hasText: 'formatDate(' })
    await action.locator('input').fill('"2024-03-05T12:00:00Z"')
    await action.getByRole('button', { name: 'Run' }).click()
    await waitFor(async () => /2024/.test(await action.locator('.result, .error').textContent()), { what: 'action result' })

    if (process.env.TYLIX_DEVTOOLS_SHOT) {
      await panel.setViewportSize({ width: 1280, height: 800 })
      await panel.screenshot({ path: process.env.TYLIX_DEVTOOLS_SHOT })
    }

    // 7. a capability's state
    await panel.locator('#capabilities .row', { hasText: 'Theme' }).click()
    await waitFor(async () => (await panel.locator('#details h1').textContent()) === 'Theme', { what: 'capability details' })
    assert.ok((await panel.locator('#details .action-row').count()) > 0)

    // 8. a page without the hook
    await app.goto('about:blank')
    await waitFor(async () => panel.locator('#nohook').isVisible(), { what: 'no-hook message' })
  } finally {
    await browser.close()
  }
})
