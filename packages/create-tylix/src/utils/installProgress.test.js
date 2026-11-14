import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createNpmTracker,
  createPnpmTracker,
  isTylixPackage,
  missingVersion,
} from './installProgress.js'

// Trimmed from a real `npm install --loglevel silly` run (npm 10.9).
const NPM_LOG = `npm silly idealTree buildDeps
npm silly fetch manifest tylix-icons@^1.5.0
npm silly placeDep ROOT @tylix/cli@1.5.0 OK for: t@1.0.0 want: ^1.5.0
npm silly placeDep ROOT @tylix/core@1.5.0 OK for: t@1.0.0 want: ^1.5.0
npm silly placeDep ROOT tylix-icons@1.5.0 OK for: t@1.0.0 want: ^1.5.0
npm silly placeDep ROOT better-sqlite3@11.0.0 OK for: t@1.0.0 want: ^11.0.0
npm silly reify moves {}
npm http cache @tylix/cli@https://registry.npmjs.org/@tylix/cli/-/cli-1.5.0.tgz 0ms (cache hit)
npm http cache tylix-icons@https://registry.npmjs.org/tylix-icons/-/tylix-icons-1.5.0.tgz 0ms (cache hit)
npm silly tarball no local data for better-sqlite3@https://registry.npmjs.org/better-sqlite3/-/better-sqlite3-11.0.0.tgz. Extracting by manifest.
npm http fetch GET 200 https://registry.npmjs.org/better-sqlite3/-/better-sqlite3-11.0.0.tgz 513ms (cache miss)
npm http fetch GET 200 https://registry.npmjs.org/@tylix%2fcore/-/core-1.5.0.tgz 90ms (cache miss)
npm silly ADD node_modules/@tylix/cli
npm silly ADD node_modules/better-sqlite3
npm info run better-sqlite3@11.0.0 install node_modules/better-sqlite3 prebuild-install || node-gyp rebuild --release
npm info run better-sqlite3@11.0.0 install { code: 0, signal: null }
added 4 packages in 11s`

test('npm tracker moves forward through every phase', () => {
  const tracker = createNpmTracker()
  const states = NPM_LOG.split('\n').map(tracker.feed).filter(Boolean)

  const fractions = states.map((s) => s.fraction)
  for (let i = 1; i < fractions.length; i++) {
    assert.ok(fractions[i] >= fractions[i - 1], `fraction went back at ${i}`)
  }
  assert.ok(fractions.every((f) => f > 0 && f < 1))

  const details = states.map((s) => s.detail)
  assert.equal(details[0], 'Resolving dependencies · 1 found · @tylix/cli')
  assert.ok(details.includes('Preparing packages · 2 of 4 · tylix-icons'))
  assert.ok(details.includes('Downloading packages · 1 of 4 · better-sqlite3'))
  assert.ok(details.includes('Downloading packages · 2 of 4 · @tylix/core'))
  assert.ok(details.includes('Linking packages · better-sqlite3'))
  assert.equal(details.at(-1), 'Running install script · better-sqlite3')
})

test('npm tracker ignores unrelated lines', () => {
  const tracker = createNpmTracker()
  assert.equal(tracker.feed('npm verbose cli /usr/bin/node'), null)
  assert.equal(tracker.feed('added 49 packages in 11s'), null)
})

test('pnpm tracker reads append-only progress lines', () => {
  const tracker = createPnpmTracker()
  const a = tracker.feed('Progress: resolved 0, reused 0, downloaded 12, added 0')
  assert.equal(a.detail, 'Downloading packages · 12 fetched')
  assert.equal(tracker.feed('Packages: +44'), null)
  const b = tracker.feed('Progress: resolved 44, reused 0, downloaded 44, added 22')
  assert.equal(b.detail, 'Linking packages · 22 of 44')
  assert.ok(b.fraction > a.fraction)
  const c = tracker.feed(
    'node_modules/.pnpm/better-sqlite3@11.0.0/node_modules/better-sqlite3 install$ prebuild-install',
  )
  assert.equal(c.detail, 'Running install script · better-sqlite3')
})

test('missingVersion reads npm and pnpm errors', () => {
  assert.equal(
    missingVersion(
      'npm error code ETARGET\nnpm error notarget No matching version found for tylix-icons@^1.5.0.\n',
    ),
    'tylix-icons@^1.5.0',
  )
  assert.equal(
    missingVersion(
      'ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @tylix/core@^9.0.0 while fetching it',
    ),
    '@tylix/core@^9.0.0',
  )
  assert.equal(missingVersion('npm error code E404'), null)
})

test('isTylixPackage only matches our packages', () => {
  assert.ok(isTylixPackage('tylix-icons@^1.5.0'))
  assert.ok(isTylixPackage('@tylix/core@^1.5.0'))
  assert.ok(!isTylixPackage('react@^19.0.0'))
  assert.ok(!isTylixPackage('@types/node@^22'))
})

test('npm cold cache: cache lines alone do not fill the download phase', () => {
  const tracker = createNpmTracker()
  for (let i = 0; i < 10; i++) {
    tracker.feed(`npm silly placeDep ROOT p${i}@1.0.0 OK for: t@1.0.0 want: ^1`)
  }
  let state
  for (let i = 0; i < 10; i++) {
    state = tracker.feed(`npm http cache p${i}@https://registry.npmjs.org/p${i}/-/p${i}-1.0.0.tgz 0ms (cache hit)`)
  }
  const afterCacheLines = state.fraction
  assert.ok(afterCacheLines < 0.5, `jumped to ${afterCacheLines}`)
  for (let i = 0; i < 10; i++) {
    state = tracker.feed(`npm http fetch GET 200 https://registry.npmjs.org/p${i}/-/p${i}-1.0.0.tgz 90ms (cache miss)`)
  }
  assert.equal(state.detail, 'Downloading packages · 10 of 10 · p9')
  assert.ok(state.fraction > 0.8)
})
