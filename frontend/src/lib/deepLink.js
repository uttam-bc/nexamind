// Deep links from notifications: App switches tab/workspace, then the feature component picks up
// the rest (which meeting, MoM, channel or task). A link that arrives before the component has
// mounted waits here until it asks for it.

const EVENT = 'nexamind:deep-link';
let pending = null;

export function openDeepLink(link) {
  pending = link;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: link }));
}

/** Returns (and clears) a pending link meant for this tab. */
export function takeDeepLink(tab) {
  if (pending && pending.tab === tab) {
    const link = pending;
    pending = null;
    return link;
  }
  return null;
}

/** Calls `handler(link)` for links to this tab, including one that arrived before mounting. */
export function onDeepLink(tab, handler) {
  const early = takeDeepLink(tab);
  if (early) setTimeout(() => handler(early), 0);
  const listener = (event) => {
    if (event.detail?.tab !== tab) return;
    pending = null;
    handler(event.detail);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
