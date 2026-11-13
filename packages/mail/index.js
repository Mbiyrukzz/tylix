// Standalone (any Node app)
export { createMailer, createFakeTransport, messageMatches } from './createMailer.js'
export * as transports from './transports/index.js'
export { MailTransportError } from './transports/http.js'
export { renderTemplate, createViewRenderer, escapeHtml } from './template.js'
export { buildMime, normalizeMessage, htmlToText, parseAddress } from './mime.js'

// Tylix apps
export { Mail, transportFromConfig, mailerFromConfig } from './Mailer.js'
export { Mailable } from './Mailable.js'
export { MailLog } from './models/MailLog.js'
