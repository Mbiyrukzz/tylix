// Turns the output of `npm install --loglevel silly` or
// `pnpm install --reporter=append-only` into an estimated fraction (0..1)
// and a short description of what the package manager is doing.
//
// Neither tool says up front how many packages it will install, so the
// first phase uses a curve that keeps moving but never reaches its cap,
// and later phases count against the total once it is known.

// Approaches `cap` as `n` grows: 1 - e^(-n/scale).
function ease(n, cap, scale) {
  return cap * (1 - Math.exp(-n / scale))
}

// "tylix-icons@1.5.0" -> "tylix-icons", "@tylix/core@1.5.0" -> "@tylix/core"
function stripVersion(id) {
  const at = id.lastIndexOf('@')
  return at > 0 ? id.slice(0, at) : id
}

// npm phases: resolving (placeDep per package), fetching (one cache/fetch
// line per tarball), linking (ADD per package), then install scripts.
const RESOLVE_END = 0.3
const FETCH_END = 0.85
const LINK_END = 0.92

export function createNpmTracker() {
  let phase = 'resolve'
  let resolved = 0
  let total = 0
  const seen = new Set() // "http cache" lines
  const done = new Set() // finished downloads
  let fetchBase = 0
  let added = 0
  let fraction = 0

  function feed(line) {
    let m

    if ((m = line.match(/^npm silly placeDep \S+ (\S+) OK/))) {
      resolved++
      fraction = ease(resolved, RESOLVE_END, 60)
      return {
        fraction,
        detail: `Resolving dependencies · ${resolved} found · ${stripVersion(m[1])}`,
      }
    }

    // Tarballs. npm logs "http cache name@url.tgz" for every package as the
    // download phase starts (even with an empty cache), then
    // "http fetch GET 200 https://registry/name/-/name-1.0.0.tgz" as each
    // real download finishes. A cache line counts a little, a download fully,
    // so a cold install fills the bar as packages actually arrive.
    const cached = line.match(/^npm http cache (\S+?)@https?:\S+\.tgz/)
    const downloaded = line.match(
      /^npm http fetch GET \d+ https?:\/\/[^/]+\/(\S+?)\/-\/\S+\.tgz/,
    )
    if (cached || downloaded) {
      if (phase === 'resolve') {
        phase = 'fetch'
        total = resolved
        fetchBase = Math.min(fraction, RESOLVE_END)
      }
      const name = decodeURIComponent((cached ?? downloaded)[1])
      ;(cached ? seen : done).add(name)
      let credit = 0
      for (const n of seen) if (!done.has(n)) credit += 0.25
      credit += done.size
      fraction = total
        ? fetchBase + (FETCH_END - fetchBase) * Math.min(1, credit / total)
        : fetchBase + ease(credit, FETCH_END - fetchBase, 60)
      const of = total ? ` of ${total}` : ''
      return {
        fraction,
        detail: done.size
          ? `Downloading packages · ${Math.min(done.size, total || done.size)}${of} · ${name}`
          : `Preparing packages · ${Math.min(seen.size, total || seen.size)}${of} · ${name}`,
      }
    }

    if ((m = line.match(/^npm silly ADD node_modules\/(\S+)/))) {
      phase = 'link'
      added++
      const linked = total ? Math.min(1, added / total) : 0
      fraction = Math.max(fraction, FETCH_END + (LINK_END - FETCH_END) * linked)
      return { fraction, detail: `Linking packages · ${m[1].replace(/.*node_modules\//, '')}` }
    }

    // "npm info run better-sqlite3@11.0.0 install node_modules/better-sqlite3 <cmd>"
    if ((m = line.match(/^npm info run (\S+) (\S+) node_modules\//))) {
      phase = 'scripts'
      fraction = Math.max(fraction, LINK_END)
      return {
        fraction,
        detail: `Running ${m[2]} script · ${stripVersion(m[1])}`,
      }
    }

    return null
  }

  return { feed }
}

export function createPnpmTracker() {
  let total = 0
  let fraction = 0

  function feed(line) {
    let m

    if ((m = line.match(/^Packages: \+(\d+)/))) {
      total = Number(m[1])
      return null
    }

    // "Progress: resolved 44, reused 0, downloaded 44, added 44, done"
    if (
      (m = line.match(
        /^Progress: resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)/,
      ))
    ) {
      const [resolved, reused, downloaded, added] = m.slice(1, 5).map(Number)
      const fetchedCount = reused + downloaded
      if (total) {
        fraction = Math.max(fraction, 0.6 + 0.35 * Math.min(1, added / total))
        return {
          fraction,
          detail: `Linking packages · ${Math.min(added, total)} of ${total}`,
        }
      }
      fraction = Math.max(fraction, ease(Math.max(resolved, fetchedCount), 0.6, 60))
      return {
        fraction,
        detail: `Downloading packages · ${fetchedCount} fetched${resolved ? ` · ${resolved} resolved` : ''}`,
      }
    }

    // pnpm's lifecycle output: ".../node_modules/better-sqlite3 install$ prebuild-install"
    if ((m = line.match(/node_modules\/(?:\.pnpm\/\S+\/node_modules\/)?((?:@[^/\s]+\/)?[^/\s]+) (preinstall|install|postinstall)\$/))) {
      fraction = Math.max(fraction, 0.95)
      return { fraction, detail: `Running ${m[2]} script · ${m[1]}` }
    }

    return null
  }

  return { feed }
}

// `name@range` from a "no matching version" error, or null.
//   npm:  "npm error notarget No matching version found for tylix-icons@^1.5.0."
//   pnpm: "ERR_PNPM_NO_MATCHING_VERSION  No matching version found for tylix-icons@^1.5.0 ..."
export function missingVersion(output) {
  const m = output.match(/No matching version found for (\S+?)\.?(?:\s|$)/)
  return m ? m[1] : null
}

// Our own packages: a missing version almost always means it was published
// a moment ago and the registry hasn't caught up, so it is worth waiting for.
export function isTylixPackage(spec) {
  const name = spec.startsWith('@')
    ? spec.split('@').slice(0, 2).join('@')
    : spec.split('@')[0]
  return name.startsWith('@tylix/') || name.startsWith('tylix')
}
