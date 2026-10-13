"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitBuildLifecycle = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({ chrome, timing, key }) {
    /** @type {import("../types/contracts").BuildState | null} */
    let state = null;
    /** @type {Promise<void> | null} */
    let pending = null;
    /** @param {Partial<import("../types/contracts").BuildState>} patch */
    async function set(patch) {
      state = timing.update(state, patch);
      await chrome.storage.local.set({ [key]: state });
    }
    /** @param {(attempt: number) => Promise<void>} run */
    function start(run, attempt = 1) {
      if (!pending)
        pending = Promise.resolve()
          .then(() => run(attempt))
          .finally(() => {
            pending = null;
          });
      return pending;
    }

    return {
      set,
      start,
      reset: () => {
        state = null;
      },
      restore: (value) => {
        state = value;
      },
      get state() {
        return state;
      },
      get running() {
        return Boolean(pending);
      },
    };
  },
);
