import { JobRecord } from './JobRecord.js'

// dispatch('SendInvoice', { invoiceId: 7 })
// dispatch('SendInvoice', { invoiceId: 7 }, { delay: 60 })   // run in a minute
export async function dispatch(jobName, payload = {}, options = {}) {
  const delay = Number(options.delay ?? 0)
  const record = {
    job: jobName,
    payload: JSON.stringify(payload),
    status: 'pending',
    attempts: 0,
  }
  // Only set when delayed, so a jobs table made before retries (no
  // available_at column) keeps working for jobs that run at once.
  if (delay > 0) record.available_at = new Date(Date.now() + delay * 1000).toISOString()
  try {
    return await JobRecord.create(record)
  } catch (err) {
    if (delay > 0 && /available_at/.test(err.message)) {
      throw new Error('dispatch(..., { delay }) needs the available_at column on the jobs table. Run "tylix make:queue-retries" then "tylix migrate".', { cause: err })
    }
    throw err
  }
}
