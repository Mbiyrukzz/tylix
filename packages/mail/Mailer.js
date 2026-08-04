import fs from 'node:fs/promises'
import path from 'node:path'
import { TemplateEngine } from '@tylix/generator'
import { SmtpDriver } from './drivers/SmtpDriver.js'
import { LogDriver } from './drivers/LogDriver.js'
import { MailLog } from './models/MailLog.js'

const templateEngine = new TemplateEngine()

function resolveDriver(config) {
  if (config.driver === 'smtp') return new SmtpDriver(config)
  return new LogDriver()
}

export class Mail {
  static async send({ to, subject, view, data = {} }, config) {
    let html = ''
    if (view) {
      const viewPath = path.join(
        process.cwd(),
        'resources',
        'mail',
        `${view}.html`,
      )
      const template = await fs.readFile(viewPath, 'utf-8')
      html = templateEngine.render(template, data)
    }

    const driver = resolveDriver(config)

    try {
      const result = await driver.deliver({ to, subject, html })
      if (config.driver === 'smtp') {
        await MailLog.create({
          recipient: to,
          subject,
          body: html,
          driver: 'smtp',
          status: result.status,
        })
      }
      return result
    } catch (err) {
      await MailLog.create({
        recipient: to,
        subject,
        body: html,
        driver: config.driver,
        status: 'failed',
        error: err.message,
      })
      throw err
    }
  }
}
