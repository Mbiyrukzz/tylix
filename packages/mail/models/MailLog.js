import { Model } from '@tylix/orm'

export class MailLog extends Model {
  static table = 'mail_logs'
  static fillable = [
    'recipient',
    'subject',
    'body',
    'driver',
    'status',
    'error',
  ]

  static async recent(limit = 50) {
    return this.query().orderBy('created_at', 'DESC').limit(limit).get()
  }
}
