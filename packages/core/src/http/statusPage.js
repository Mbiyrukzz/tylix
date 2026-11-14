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

// A themed, self-contained page for a status a browser should see as a
// page rather than JSON: 404, a production 500, an email link's result.
// It needs nothing from the app (styles are inline), so it still works
// when the app itself is what broke.
//
// tone: 'success' | 'error' | 'notfound'
// requestId: shown as a reference the visitor can quote when reporting
// the problem; the same id is on the server's log line for the request.
export function renderStatusPage({
  title,
  message,
  tone = 'error',
  code = null,
  requestId = null,
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
    --bg:#f3f2f6; --card:#ffffff; --border:#dedbe6; --border-strong:#c9c5d4;
    --text:#17151c; --muted:#6b6878; --brand:#0034ca; --brand-hover:#1a4be0;
    --success:#0d8c67; --success-soft:rgba(13,140,103,.12);
    --error:#cd3c3c; --error-soft:rgba(205,60,60,.10);
    --notfound:#bd6226; --notfound-soft:rgba(189,98,38,.12);
  }
  html.dark {
    --bg:#17161c; --card:#211f27; --border:#34313d; --border-strong:#46424f;
    --text:#ecebf1; --muted:#9592a3; --brand:#3563ff; --brand-hover:#547cff;
    --success:#5fe3b5; --success-soft:rgba(95,227,181,.12);
    --error:#ff7b7b; --error-soft:rgba(255,123,123,.12);
    --notfound:#ffb38a; --notfound-soft:rgba(255,179,138,.12);
  }
  html { color-scheme: light; } html.dark { color-scheme: dark; }
  body {
    margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
    background:var(--bg); color:var(--text); -webkit-font-smoothing:antialiased;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif;
  }
  .card {
    width:100%; max-width:440px; text-align:center; padding:36px 32px 32px;
    border:1px solid transparent; border-radius:20px;
    background:linear-gradient(var(--card),var(--card)) padding-box, linear-gradient(135deg,#6fe0ea,#c8f07a) border-box;
    box-shadow:0 0 32px -8px rgba(111,224,234,.35), 0 12px 32px -16px rgba(0,0,0,.25);
  }
  .brand { display:inline-flex; align-items:center; gap:8px; margin-bottom:24px; font-weight:600; color:var(--text); text-decoration:none; }
  .brand img { height:20px; width:auto; }
  html.dark .brand img { filter:brightness(1.7) saturate(1.1); }
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
    font-size:14px; font-weight:600; text-decoration:none; padding:9px 18px; border-radius:9px;
    color:var(--text); border:1px solid var(--border-strong); background:transparent; transition:all .15s;
  }
  .btn:hover { border-color:var(--brand); color:var(--brand); }
  .btn-primary { color:#fff; border-color:transparent; background:var(--brand); }
  .btn-primary:hover { color:#fff; background:var(--brand-hover); box-shadow:0 6px 18px -8px var(--brand); }
  .ref { margin:22px 0 0; font-size:12px; color:var(--muted); }
  .ref code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; padding:2px 6px;
    border-radius:6px; background:var(--bg); border:1px solid var(--border); user-select:all; }
</style>
</head>
<body>
  <div class="card tone-${esc(tone)}">
    <a class="brand" href="/"><img src="/logo-mark.svg" alt="" onerror="if(!this.dataset.png){this.dataset.png=1;this.src='/logo-mark.png'}else{this.remove()}">Tylix</a>
    <div class="icon">${ICONS[tone] ?? ICONS.error}</div>
    ${code ? `<p class="code">${esc(code)}</p>` : ''}
    <h1>${esc(title)}</h1>
    <p class="msg">${esc(message)}</p>
    <div class="actions">${buttons}</div>
    ${requestId ? `<p class="ref">Reference <code>${esc(requestId)}</code></p>` : ''}
  </div>
</body>
</html>`
}

