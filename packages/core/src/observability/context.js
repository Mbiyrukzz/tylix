import { AsyncLocalStorage } from 'node:async_hooks'

// The request being handled, available anywhere below the handler (models,
// services, jobs it awaits) without passing it along. The server runs
// each request inside it; logs use it to add the request's id.
//
//   currentRequest()?.requestId
export const requestContext = new AsyncLocalStorage()

export function currentRequest() {
  return requestContext.getStore() ?? null
}
