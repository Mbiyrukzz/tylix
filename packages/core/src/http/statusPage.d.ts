export interface StatusPageAction {
  label: string
  href: string
}

export interface StatusPageOptions {
  title: string
  message: string
  /** Colour and icon. Defaults to 'error'. */
  tone?: 'success' | 'error' | 'notfound'
  /** Small label above the title, e.g. '404'. */
  code?: string | null
  /** Shown as a reference the visitor can quote; matches the request's log line. */
  requestId?: string | null
  /** Buttons; the first is the primary one. Defaults to "Go home". */
  actions?: StatusPageAction[]
}

/** A self-contained, themed HTML page for a status a browser should see as a page. */
export function renderStatusPage(options: StatusPageOptions): string
