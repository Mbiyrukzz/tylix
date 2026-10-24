import { Model } from '@tylix/orm'

export interface MailConfig {
  /** Anything other than "smtp" falls back to the log driver. */
  driver?: 'smtp' | 'log'
  /** Sender address. Required for the smtp driver. */
  from?: string
  host?: string
  port?: number
  /** true = implicit TLS (port 465). Port 587 upgrades with STARTTLS. */
  secure?: boolean
  user?: string
  password?: string
  /** Name announced in EHLO. Defaults to "localhost". */
  clientName?: string
}

export interface MailContent {
  subject: string
  /** Name of an HTML file in resources/mail/, without the extension. */
  view?: string
  /** Values rendered into the view template. */
  data?: Record<string, unknown>
}

export interface SendMailOptions extends MailContent {
  to: string | string[]
}

export interface DeliveryResult {
  status: 'sent' | 'captured'
}

export class Mail {
  static send(options: SendMailOptions, config: MailConfig): Promise<DeliveryResult>
}

export abstract class Mailable {
  abstract build(): MailContent
  send(to: string | string[], config: MailConfig): Promise<DeliveryResult>
}

export class MailLog extends Model {
  static table: string
  static fillable: string[]
  static recent(limit?: number): Promise<MailLog[]>

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