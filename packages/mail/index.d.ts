// ------------------------------------------------------------- messages

/** "ada@example.com", "Ada <ada@example.com>" or { name, address }. */
export type Address = string | { name?: string; address: string }

export interface Attachment {
  filename?: string
  /** File contents. A string is UTF-8 unless `encoding: 'base64'`. */
  content?: Buffer | Uint8Array | string
  /** Read from disk at send time instead of `content`. */
  path?: string
  encoding?: 'base64' | 'utf8'
  /** Guessed from the file name when omitted. */
  contentType?: string
  /** Makes it an inline image, referenced in HTML as <img src="cid:ID">. */
  cid?: string
}

export interface MailMessage {
  to?: Address | Address[]
  cc?: Address | Address[]
  bcc?: Address | Address[]
  /** Defaults to the mailer's `from`. */
  from?: Address
  replyTo?: Address | Address[]
  subject?: string
  html?: string
  /** Generated from `html` when omitted. */
  text?: string
  /** A template rendered with `data` by the mailer's `views`. */
  view?: string
  data?: Record<string, unknown>
  attachments?: Attachment[]
  headers?: Record<string, string>
  /** Provider tags / metadata (Resend tags, SendGrid custom_args, Postmark Tag + Metadata, Mailgun o:tag / v:, SES EmailTags). */
  tags?: Record<string, string | number>
}

export interface ParsedAddress {
  name: string
  address: string
}

/** What transports receive and fakes record. */
export interface NormalizedMessage {
  from: ParsedAddress
  to: ParsedAddress[]
  cc: ParsedAddress[]
  bcc: ParsedAddress[]
  replyTo: ParsedAddress[]
  subject: string
  html: string
  text: string
  headers: Record<string, string>
  attachments: { filename: string; content: Buffer; contentType: string; cid: string | null }[]
  tags: Record<string, string | number>
  view: string | null
  data: Record<string, unknown> | null
}

export interface SendResult {
  status: 'sent' | 'captured'
  /** The provider's message id, when it returns one. */
  id: string | null
  transport: string
  message: NormalizedMessage
}

// ------------------------------------------------------------ transports

export interface MailTransport {
  name?: string
  send(message: NormalizedMessage): Promise<{ status?: 'sent' | 'captured'; id?: string | null }>
}

export interface SmtpOptions {
  host: string
  /** Default 587 (STARTTLS). */
  port?: number
  /** Implicit TLS (port 465). */
  secure?: boolean
  user?: string
  password?: string
  /** Name announced in EHLO. Default "localhost". */
  clientName?: string
  /** true: STARTTLS on any port; false: never (local test servers). Default: only on 587. */
  requireTLS?: boolean
  timeoutMs?: number
}

export declare const transports: {
  smtp(options: SmtpOptions): MailTransport
  resend(options: { apiKey: string; endpoint?: string; fetch?: typeof fetch }): MailTransport
  sendgrid(options: { apiKey: string; endpoint?: string; fetch?: typeof fetch }): MailTransport
  postmark(options: { serverToken: string; messageStream?: string; endpoint?: string; fetch?: typeof fetch }): MailTransport
  mailgun(options: { apiKey: string; domain: string; region?: 'us' | 'eu'; endpoint?: string; fetch?: typeof fetch }): MailTransport
  /** Credentials default to AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN. */
  ses(options?: {
    region?: string
    accessKeyId?: string
    secretAccessKey?: string
    sessionToken?: string
    configurationSet?: string
    endpoint?: string
    fetch?: typeof fetch
  }): MailTransport
  /** Prints messages instead of sending them. */
  log(options?: { logger?: { log(text: string): void }; showBody?: boolean }): MailTransport
  /** Keeps messages in `.messages`. */
  memory(): MailTransport & { messages: NormalizedMessage[] }
}

export declare class MailTransportError extends Error {
  provider: string
  status: number
  response: unknown
}

// ---------------------------------------------------------------- mailer

/** A message without `to`, built by a Mailable. */
export type MailContent = Omit<MailMessage, 'to'> & { to?: MailMessage['to'] }

export interface MailerOptions {
  /** Default: transports.log() */
  transport?: MailTransport
  from?: Address
  replyTo?: Address | Address[]
  /** Headers added to every message. */
  headers?: Record<string, string>
  /** A folder of <view>.html (+ optional <view>.txt) templates, or a render function. */
  views?: string | ((view: string, data: Record<string, unknown>) => Promise<string | { html?: string; text?: string }> | string | { html?: string; text?: string })
  onSent?(result: SendResult): void | Promise<void>
  onError?(error: Error, info: { transport: string; message: NormalizedMessage }): void | Promise<void>
}

export interface Mailer {
  readonly transport: MailTransport
  useTransport(transport: MailTransport): MailTransport
  send(message: MailMessage | Mailable, to?: MailMessage['to']): Promise<SendResult>
  /** The message with its view rendered and defaults applied, not sent. */
  prepare(message: MailMessage | Mailable, to?: MailMessage['to']): Promise<NormalizedMessage>
  /** Like prepare(), plus the complete .eml text as `raw`. */
  preview(message: MailMessage | Mailable, to?: MailMessage['to']): Promise<NormalizedMessage & { raw: string }>
}

export declare function createMailer(options?: MailerOptions): Mailer

/** Fields compared exactly (RegExps match; html/text strings are "contains"), or a predicate. */
export type MessageMatch =
  | ((message: NormalizedMessage) => boolean)
  | {
      to?: string | RegExp | (string | RegExp)[]
      cc?: string | RegExp | (string | RegExp)[]
      bcc?: string | RegExp | (string | RegExp)[]
      replyTo?: string | RegExp | (string | RegExp)[]
      from?: string | RegExp
      subject?: string | RegExp
      view?: string | RegExp
      html?: string | RegExp
      text?: string | RegExp
    }

export interface FakeTransport extends MailTransport {
  sent: NormalizedMessage[]
  last(): NormalizedMessage | null
  find(match?: MessageMatch): NormalizedMessage[]
  /** Throws unless a matching message was sent (exactly `times` when given). */
  assertSent(match?: MessageMatch, times?: number): NormalizedMessage[]
  assertNotSent(match?: MessageMatch): void
  assertNothingSent(): void
  assertSentCount(count: number): void
  clear(): void
}

export declare function createFakeTransport(): FakeTransport
export declare function messageMatches(message: NormalizedMessage, match: MessageMatch): boolean

// ------------------------------------------------------------- templates

/** {{ value }} (escaped), {{{ raw }}}, {{ a.b }}, {{#if x}}…{{#else}}…{{/if}}, {{#each list}}…{{ this }} {{ @index }}…{{/each}} */
export declare function renderTemplate(template: string, data?: Record<string, unknown>, name?: string): string
export declare function createViewRenderer(dir: string): (view: string, data: Record<string, unknown>) => Promise<{ html: string; text?: string }>
export declare function escapeHtml(value: unknown): string
export declare function htmlToText(html: string): string
export declare function parseAddress(address: Address, label?: string): ParsedAddress
export declare function normalizeMessage(message: MailMessage, defaults?: Partial<MailMessage>): Omit<NormalizedMessage, 'view' | 'data'>
export declare function buildMime(message: NormalizedMessage): { raw: string; messageId: string; envelope: { from: string; to: string[] } }

// ------------------------------------------------------------ Tylix apps

export interface MailConfig extends Partial<SmtpOptions> {
  /** Default "log". */
  driver?: 'log' | 'smtp' | 'resend' | 'sendgrid' | 'postmark' | 'mailgun' | 'ses' | 'memory'
  /** A transport object; wins over `driver`. */
  transport?: MailTransport
  from?: Address
  replyTo?: Address | Address[]
  /** Template folder. Default: resources/mail */
  views?: MailerOptions['views']
  /** resend, sendgrid, postmark, mailgun */
  apiKey?: string
  /** postmark (falls back to apiKey) */
  serverToken?: string
  messageStream?: string
  /** mailgun */
  domain?: string
  /** mailgun ('us' | 'eu') or ses (AWS region) */
  region?: string
  /** ses */
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  configurationSet?: string
}

export declare function transportFromConfig(config?: MailConfig): MailTransport
export declare function mailerFromConfig(config?: MailConfig): Mailer

export declare class Mail {
  static send(message: MailMessage | Mailable, config?: MailConfig): Promise<SendResult>
  static preview(message: MailMessage | Mailable, config?: MailConfig): Promise<NormalizedMessage & { raw: string }>
  /** Captures every Mail.send() until Mail.restore(). */
  static fake(): FakeTransport
  static restore(): void
}

export declare abstract class Mailable {
  abstract build(): MailContent | Promise<MailContent>
  send(to: MailMessage['to'], config?: MailConfig): Promise<SendResult>
}

/** The mail_logs model. `available` is false when @tylix/orm is not installed. */
export declare class MailLog {
  static available: boolean
  static table: string
  static fillable: string[]
  static recent(limit?: number): Promise<MailLog[]>
  static create(attributes: Partial<MailLog>): Promise<MailLog>

  id: number
  recipient: string
  subject: string
  body: string
  driver: string
  status: string
  error?: string | null
  created_at?: string
  updated_at?: string
}
