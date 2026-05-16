const { AsyncLocalStorage } = require('async_hooks');

/**
 * Per-request context using AsyncLocalStorage.
 *
 * AL2 (Sprint 4): a long-standing audit gap was that service-layer
 * `logAction` calls had no access to `req`, so `ip` and `userAgent` were
 * always null. Threading `req` through every service signature would be a
 * wide refactor with low payoff.
 *
 * Instead, we stash a reference to the live request in AsyncLocalStorage
 * once per request (via `requestContextMiddleware`). Anything running inside
 * the same async chain — including deep-nested service calls — can pull the
 * request back out with `getRequest()` without explicit threading.
 *
 * Caveats:
 *   - Don't store the full request long-term; the LS is scoped to the
 *     request lifecycle and the reference dies after the response is sent.
 *   - Background jobs (cron, queue workers) run OUTSIDE any request and will
 *     see `undefined` here. That is correct — there's no user/IP to attribute.
 */

const _storage = new AsyncLocalStorage();

/** Get the current request, or null if not inside an HTTP-handler context. */
const getRequest = () => _storage.getStore() || null;

/** Express middleware: stash req in async storage for the rest of the chain. */
const requestContextMiddleware = (req, res, next) => {
  _storage.run(req, () => next());
};

module.exports = { getRequest, requestContextMiddleware };
