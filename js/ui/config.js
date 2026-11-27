// Where the game is published, e.g. 'https://yourname.github.io/sentence-similarity/'.
// Invite links always point here, so a link shared from the local preview (127.0.0.1, which only works on
// the phone running it) still opens on other phones. Empty: use the page's own address when it's public.
export const PUBLIC_URL = 'https://edrugatz.github.io/telephone-sabatoge/';

const LOCAL_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/;

/** True when this address only works on this device. */
export function isLocalAddress(hostname) {
  return LOCAL_HOSTS.test(hostname);
}

/**
 * The invite link for a game code, or null when there's no address other phones can open.
 * `here` = { origin, pathname, hostname } of the current page (location).
 */
export function inviteLink(code, here, publicUrl = PUBLIC_URL) {
  if (publicUrl) {
    const url = new URL(publicUrl);
    url.search = `?join=${code}`;
    return url.href;
  }
  if (isLocalAddress(here.hostname)) return null;
  return `${here.origin}${here.pathname}?join=${code}`;
}
