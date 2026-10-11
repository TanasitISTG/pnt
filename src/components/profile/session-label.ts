/**
 * Turns a stored user agent into something a person recognizes.
 *
 * Anything the pattern list does not match falls back to a neutral label rather than
 * echoing the raw header: it is both unhelpful and untrusted text from a request that
 * chose it.
 */
export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";

  const browser = /firefox/i.test(userAgent)
    ? "Firefox"
    : /edg\//i.test(userAgent)
      ? "Edge"
      : /chrome|crios/i.test(userAgent)
        ? "Chrome"
        : /safari/i.test(userAgent)
          ? "Safari"
          : "Browser";

  // Order matters: an iPhone reports "like Mac OS X", and Android reports "Linux",
  // so the mobile checks have to run before the desktop platforms they embed.
  const platform = /windows/i.test(userAgent)
    ? "Windows"
    : /iphone|ipad|ipod|ios/i.test(userAgent)
      ? "iOS"
      : /android/i.test(userAgent)
        ? "Android"
        : /mac os|macintosh/i.test(userAgent)
          ? "macOS"
          : /linux/i.test(userAgent)
            ? "Linux"
            : null;

  return platform ? `${browser} on ${platform}` : browser;
}
