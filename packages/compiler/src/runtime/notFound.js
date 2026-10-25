// Swaps the current page for the closest _not-found.tyx. The server renders
// it with a 404 status and puts the original URL back in the address bar.
export function notFound() {
  const here = window.location.pathname + window.location.search
  window.location.replace('/_tylix/not-found?path=' + encodeURIComponent(here))
}