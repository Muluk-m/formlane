/** Normalize an explicit API origin; only local development may use plain HTTP. */
export function apiOrigin(value, name, allowLocal = true) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(`${name} must be an explicit absolute origin.`)
  }
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    ![url.origin, `${url.origin}/`].includes(value)
  ) {
    throw new Error(
      `${name} must be an HTTPS origin without credentials, path, query or fragment; HTTP is allowed only for local development.`,
    )
  }
  return url.origin
}
