/** Root is the public site. Existing sample links and OAuth errors still enter the reader. */
export function isLandingRoute(pathname: string, search: string): boolean {
  const params = new URLSearchParams(search)
  return pathname === '/' && !params.has('sample') && !params.has('auth_error')
}
