import fs from 'node:fs/promises'
import path from 'node:path'

// The HTML document around every page. The project owns it: add fonts,
// meta tags, scripts and the favicon link here. The three %tylix.*%
// placeholders are filled in by the compiler on every request.
const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>%tylix.title%</title>
  <link rel="icon" type="image/png" href="/favicon.png">

  <!-- Fonts, extra meta tags and scripts go here, before %tylix.head% -->

  %tylix.head%
</head>
<body>
  %tylix.body%
</body>
</html>
`

// The loading indicator. Edit it like any other page. Delete the file to
// fall back to the built-in top bar.
const LOADING_TYX = `<script>
// The loading indicator. It shows while the page makes requests (useApi,
// capabilities, prefetch) and is edited like any other page.
//
// Tylix gives it one prop, "loading":
//   loading.active    number of requests in flight
//   loading.progress  0 to 100
//   loading.visible   true while something is loading
props
  loading: any
</script>
<template>
  <div
    style="{{
      'position:fixed;top:0;left:0;height:3px;z-index:99999;pointer-events:none;' +
      'background:#10b981;transition:width 0.2s ease, opacity 0.3s ease;' +
      'width:' + loading.progress + '%;' +
      'opacity:' + (loading.visible ? 1 : 0)
    }}"
  ></div>
</template>
`

export async function writeIndexHtml(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  await fs.writeFile(path.join(targetDir, 'app', 'index.html'), INDEX_HTML)
  await fs.writeFile(path.join(targetDir, 'app', 'loading.tyx'), LOADING_TYX)
}