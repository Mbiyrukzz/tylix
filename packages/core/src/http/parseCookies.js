// No cookie-parser here — Tylix's HTTP layer is hand-rolled on top of
// node:http, so cookies need to be parsed off the raw `Cookie` header
// the same way parseQuery.js handles the URL's query string.
export function parseCookies(req) {
    const header = req.headers?.cookie;
    if (!header) return {};

    const cookies = {};
    for (const pair of header.split(";")) {
        const separatorIndex = pair.indexOf("=");
        if (separatorIndex === -1) continue;

        const key = pair.slice(0, separatorIndex).trim();
        const value = pair.slice(separatorIndex + 1).trim();
        if (!key) continue;

        cookies[key] = decodeURIComponent(value);
    }

    return cookies;
}
