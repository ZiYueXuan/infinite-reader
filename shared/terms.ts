/** Bump this version whenever the agreement changes; keep the previous text in git history. */
export const TERMS_VERSION = '2026-10-29'
export const TERMS_URL = `/terms?version=${TERMS_VERSION}`
export interface TermsConsent { accepted: true; version: string }
