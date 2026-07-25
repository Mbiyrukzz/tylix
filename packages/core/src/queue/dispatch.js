import { JobRecord } from './JobRecord.js'

export async function dispatch(jobName, payload = {}) {
  return JobRecord.create({
    job: jobName,
    payload: JSON.stringify(payload),
    status: 'pending',
    attempts: 0,
  })
}
