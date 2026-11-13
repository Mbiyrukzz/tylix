// The page itself lives in @tylix/core, so the HTTP server can show it for
// errors too (a production 500 to a browser).
export { renderStatusPage } from '@tylix/core'

// True for a browser navigation, false for fetch/curl/API clients.
// Same rule as Server.js: Sec-Fetch-Dest first, Accept as the fallback.
export function wantsHtml(req) {
  if (req.method !== 'GET') return false
  const dest = req.headers?.['sec-fetch-dest']
  if (dest) return dest === 'document'
  return String(req.headers?.accept ?? '').includes('text/html')
}