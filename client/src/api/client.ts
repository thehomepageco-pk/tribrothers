export class ApiError extends Error {
  status: number
  data: unknown

  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

async function parseBody(res: Response) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers || {})
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
  if (!isForm && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
  })

  const data = await parseBody(res)

  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data && String((data as { error: unknown }).error)) ||
      (data && typeof data === 'object' && 'message' in data && String((data as { message: unknown }).message)) ||
      res.statusText ||
      'Request failed'
    if (
      typeof window !== 'undefined' &&
      res.status === 403 &&
      data &&
      typeof data === 'object' &&
      'code' in data &&
      (data as { code?: string }).code === 'ADMIN_UNLOCK_REQUIRED'
    ) {
      window.dispatchEvent(
        new CustomEvent('tri:need-unlock', {
          detail: {
            permission: (data as { permission?: string }).permission || 'canEdit',
            message,
          },
        }),
      )
    }
    throw new ApiError(res.status, message, data)
  }

  return data as T
}

export function apiForm<T = unknown>(path: string, form: FormData, method: 'POST' | 'PUT' = 'POST') {
  return api<T>(path, { method, body: form })
}
