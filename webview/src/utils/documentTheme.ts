export type UiTheme = 'light' | 'dark';

/**
 * Drop the page-load background that Java injects on <html>/<body>.
 *
 * HtmlLoader bakes a fixed `background-color` into both tags using the theme it
 * observed while the page HTML was built (anti-flash before CSS loads). The value
 * is frozen: if the theme changes later — or the observation was wrong — the stale
 * color shows through every transparent gap (e.g. the strip around the status
 * panel tabs). Once the app applies a theme the CSS `body { background: var(--bg-chat) }`
 * rule is authoritative, so the inline value must go.
 */
export function clearInjectedPageBackground(): void {
  document.documentElement?.style.removeProperty('background-color');
  document.body?.style.removeProperty('background-color');
}

/**
 * Apply a resolved UI theme to the document: set `data-theme` (drives all CSS
 * variables) and clear the stale injected page background.
 */
export function applyDocumentTheme(theme: UiTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
  clearInjectedPageBackground();
}
