// Google Sites hosts many unrelated businesses under one hostname.
export function hostedSalonPath(url: URL): string | null {
  if (url.hostname.toLowerCase() !== "sites.google.com") return null;
  return url.pathname.match(/^\/(?:view|site)\/[^/]+(?=\/|$)/)?.[0] ?? null;
}

export function sameSalonWebsite(left: URL, right: URL): boolean {
  const host = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");
  if (host(left) !== host(right)) return false;
  if (host(left) === "sites.google.com") {
    const scope = hostedSalonPath(left);
    return Boolean(scope && scope === hostedSalonPath(right));
  }
  return true;
}

export function salonRelativePage(base: URL, path: string): URL {
  const scope = hostedSalonPath(base);
  return new URL(scope ? scope + path : path, base.origin);
}
