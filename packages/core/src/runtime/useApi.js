export async function useApi(url, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    credentials = 'include',
  } = options

  const finalHeaders = { ...headers }
  let finalBody = body
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    finalHeaders['Content-Type'] =
      finalHeaders['Content-Type'] || 'application/json'
    finalBody = JSON.stringify(body)
  }

  try {
    const response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: finalBody,
      credentials,
    })
    let data = null
    try {
      data = await response.json()
    } catch {
      /* empty body */
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        error: (data && (data.error || data.message)) || 'Request failed',
      }
    }
    return { ok: true, status: response.status, data, error: null }
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message }
  }
}
