function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const ICONS = {
  success:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  notfound:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
}

// tone: 'success' | 'error' | 'notfound'
export function renderStatusPage({
  title,
  message,
  tone = 'error',
  code = null,
  actions = [{ label: 'Go home', href: '/' }],
}) {
  const buttons = actions
    .map(
      (a, i) =>
        `<a class="btn${i === 0 ? ' btn-primary' : ''}" href="${esc(a.href)}">${esc(a.label)}</a>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" type="image/png" href="/favicon.png">
<script>
  (function () {
    var stored = null;
    try { stored = localStorage.getItem("theme"); } catch (e) {}
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (stored === "dark" || (!stored && prefersDark)) document.documentElement.classList.add("dark");
  })();
</script>
<style>
  * { box-sizing: border-box; }
  :root {
    --bg:#f8fafc; --card:#ffffff; --border:#e2e8f0; --border-strong:#cbd5e1;
    --text:#0f172a; --muted:#64748b;
    --success:#059669; --success-soft:rgba(16,185,129,.12);
    --error:#e11d48; --error-soft:rgba(225,29,72,.10);
    --notfound:#d97706; --notfound-soft:rgba(245,158,11,.14);
  }
  html.dark {
    --bg:#020617; --card:#0f172a; --border:#1e293b; --border-strong:#334155;
    --text:#e2e8f0; --muted:#94a3b8;
    --success:#34d399; --success-soft:rgba(52,211,153,.12);
    --error:#fb7185; --error-soft:rgba(251,113,133,.12);
    --notfound:#fbbf24; --notfound-soft:rgba(251,191,36,.12);
  }
  html { color-scheme: light; } html.dark { color-scheme: dark; }
  body {
    margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
    background:var(--bg); color:var(--text); -webkit-font-smoothing:antialiased;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif;
  }
  .card {
    width:100%; max-width:440px; text-align:center; padding:36px 32px 32px;
    background:var(--card); border:1px solid var(--border); border-radius:20px;
    box-shadow:0 1px 2px rgba(15,23,42,.05), 0 12px 32px rgba(15,23,42,.06);
  }
  html.dark .card { box-shadow:none; }
  .brand { display:inline-flex; align-items:center; gap:8px; margin-bottom:24px; font-weight:600; color:var(--text); text-decoration:none; }
  .brand img { width:26px; height:26px; }
  .icon { width:60px; height:60px; margin:0 auto 18px; border-radius:50%; display:grid; place-items:center;
    color:var(--tone); background:var(--tone-soft); }
  .tone-success { --tone:var(--success); --tone-soft:var(--success-soft); }
  .tone-error { --tone:var(--error); --tone-soft:var(--error-soft); }
  .tone-notfound { --tone:var(--notfound); --tone-soft:var(--notfound-soft); }
  .code { font-size:12px; font-weight:700; letter-spacing:.1em; color:var(--tone); margin:0 0 6px; }
  h1 { margin:0 0 8px; font-size:22px; letter-spacing:-.01em; }
  p.msg { margin:0 0 24px; color:var(--muted); font-size:14px; line-height:1.6; }
  .actions { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
  .btn {
    font-size:14px; font-weight:600; text-decoration:none; padding:9px 18px; border-radius:999px;
    color:var(--text); border:1px solid var(--border-strong); background:transparent; transition:all .15s;
  }
  .btn:hover { border-color:var(--success); color:var(--success); }
  .btn-primary { color:#fff; border-color:transparent; background:linear-gradient(90deg,#34d399,#059669); }
  .btn-primary:hover { color:#fff; transform:translateY(-1px); box-shadow:0 6px 16px rgba(5,150,105,.3); }
</style>
</head>
<body>
  <div class="card tone-${esc(tone)}">
    <a class="brand" href="/"><img src="/logo-mark.png" alt="">Tylix</a>
    <div class="icon">${ICONS[tone] ?? ICONS.error}</div>
    ${code ? `<p class="code">${esc(code)}</p>` : ''}
    <h1>${esc(title)}</h1>
    <p class="msg">${esc(message)}</p>
    <div class="actions">${buttons}</div>
  </div>
</body>
</html>`
}

// True for a browser navigation, false for fetch/curl/API clients.
// Same rule as Server.js: Sec-Fetch-Dest first, Accept as the fallback.
export function wantsHtml(req) {
  if (req.method !== 'GET') return false
  const dest = req.headers?.['sec-fetch-dest']
  if (dest) return dest === 'document'
  return String(req.headers?.accept ?? '').includes('text/html')
}