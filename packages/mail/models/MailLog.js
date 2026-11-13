// mail_logs rows, when the app uses @tylix/orm. Without it (a plain
// Node app using createMailer) this is a stand-in with available=false,
// and Mail skips logging.
let Model = null
try {
  ;({ Model } = await import('@tylix/orm'))
} catch {
  Model = null
}

function missing() {
  throw new Error('MailLog needs @tylix/orm: npm install @tylix/orm')
}

export const MailLog = Model
  ? class MailLog extends Model {
      static available = true
      static table = 'mail_logs'
      static fillable = ['recipient', 'subject', 'body', 'driver', 'status', 'error']

      static async recent(limit = 50) {
        return this.query().orderBy('created_at', 'DESC').limit(limit).get()
      }
    }
  : class MailLog {
      static available = false
      static create = missing
      static query = missing
      static async recent() {
        return []
      }
    }
