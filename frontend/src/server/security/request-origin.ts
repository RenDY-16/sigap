/** Validate browser provenance without trusting proxy-supplied headers. */
export function isAllowedRequestOrigin(
  origin: string | undefined,
  fetchSite: string | undefined,
  host: string | undefined,
  secure: boolean,
): boolean {
  if (fetchSite && fetchSite !== "same-origin") return false;
  if (origin !== undefined) {
    return Boolean(host) && origin === `${secure ? "https" : "http"}://${host}`;
  }
  // Native clients can omit browser provenance. This is not authorization:
  // their session/token and role must still pass the normal access checks.
  return true;
}
