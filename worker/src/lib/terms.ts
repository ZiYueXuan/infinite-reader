import type { Context } from 'hono';
import type { AppEnv } from '../auth';
import { TERMS_VERSION } from '../../../shared/terms';
import { HttpError, newId, now } from './util';

export function requireTermsConsent(consent: { accepted?: boolean; version?: string } | undefined) {
  if (consent?.accepted !== true) throw new HttpError(403, 'terms_required', 'Please read and accept the Terms of Use before signing in.');
  if (consent.version !== TERMS_VERSION) throw new HttpError(403, 'terms_updated', 'The Terms of Use have changed. Refresh this page, read the current terms and accept them.');
}

export async function recordTermsConsent(c: Context<AppEnv>, userId: string, method: 'email' | 'google', acceptedAt = now()) {
  await c.env.DB.prepare('INSERT INTO terms_acceptances (id, user_id, terms_version, accepted_at, recorded_at, method) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(newId(), userId, TERMS_VERSION, acceptedAt, now(), method).run();
}
