/**
 * Recognizes a YouTube/Vimeo URL and resolves it to that provider's
 * embeddable player URL - the canvas link node renders an inline `<iframe>`
 * player instead of a plain card whenever this returns non-null. Pure
 * string parsing, no network call - a false negative (an unrecognized
 * video host) just falls back to the plain link card, never a broken
 * embed.
 */
export function getVideoEmbedUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '');

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    const shortsMatch = /^\/shorts\/([\w-]+)/.exec(parsed.pathname);
    if (shortsMatch) return `https://www.youtube.com/embed/${shortsMatch[1]}`;
    const embedMatch = /^\/embed\/([\w-]+)/.exec(parsed.pathname);
    if (embedMatch) return `https://www.youtube.com/embed/${embedMatch[1]}`;
    return null;
  }

  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1);
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }

  if (host === 'vimeo.com') {
    const id = /^\/(\d+)/.exec(parsed.pathname)?.[1];
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }

  if (host === 'player.vimeo.com') {
    return /^\/video\/\d+/.test(parsed.pathname) ? url : null;
  }

  return null;
}
