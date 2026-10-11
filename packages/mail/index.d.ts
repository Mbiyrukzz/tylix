import { Model } from '@tylix/orm'

export interface MailContent {
  subject: string
  view: string
  data?: Record<string, unknown>
}

export interface MailConfig {
  driver?: 'smtp' | 'log'
  host?: string
  port?: number
  user?: string
  password?: string
  from?: string
  [key: string]: unknown
}

export abstract class Mailable {
  abstract build(): MailContent
  send(to: string, config?: MailConfig): Promise<unknown>
}

export class MailLog extends Model {
  id: number
  recipient: string
  subject: string
  body: string
  created_at?: string
}

export const Mail: {
  send(to: string, mailable: Mailable, config?: MailConfig): Promise<unknown>
}