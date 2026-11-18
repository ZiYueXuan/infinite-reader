/** Cost debug access comes from the Worker environment for the authenticated email. */
export function canViewCostDebug(email: string, allowlist?: string): boolean {
  const normalized = email.trim().toLowerCase();
  return !!normalized && (allowlist ?? '').split(',').some(value => value.trim().toLowerCase() === normalized);
}
