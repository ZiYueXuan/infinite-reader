import { type TermsConsent } from '../../../shared/terms'
import { api, jsonBody } from './http'

export interface User {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  can_view_cost_debug: boolean
}

export const authApi = {
  providers: () => api<{ email: boolean; google: boolean }>('/auth/providers', { signal: AbortSignal.timeout(8000) }),
  me: async (signal?: AbortSignal) => (await api<{ user: User }>('/auth/me', { signal })).user,
  requestCode: (email: string) => api<{ ok: true; expiresInSec: number }>('/auth/email/request', { method: 'POST', body: jsonBody({ email }) }),
  verify: async (email: string, code: string, terms: TermsConsent) => (await api<{ user: User }>('/auth/email/verify', { method: 'POST', body: jsonBody({ email, code, terms }) })).user,
  logout: () => api<{ ok: true }>('/auth/logout', { method: 'POST' }),
  googleStart: (next: string, terms: TermsConsent) => api<{ url: string }>('/auth/google/start', { method: 'POST', body: jsonBody({ next, terms }) }),
}
