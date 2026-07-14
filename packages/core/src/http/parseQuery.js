export function parseQuery(url) {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return {};

  const params = new URLSearchParams(url.slice(queryStart + 1));
  return Object.fromEntries(params.entries());
}
