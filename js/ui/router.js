// Screen router (P6): state-driven, not URL-driven. main.js decides which screen fits the current state
// and calls show(); the router swaps the content and scrolls to the top when the screen changes.

export function createRouter(root) {
  let current = null;
  return {
    get current() {
      return current;
    },
    /** Replace the screen. Re-showing the same screen (a live update) keeps the scroll position. */
    show(name, element) {
      const changed = name !== current;
      current = name;
      root.replaceChildren(element);
      root.dataset.screen = name;
      if (changed) window.scrollTo(0, 0);
    },
  };
}
