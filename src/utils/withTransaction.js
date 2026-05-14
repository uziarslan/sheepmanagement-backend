const mongoose = require('mongoose');
const logger = require('./logger');

/**
 * Run `fn(session)` inside a MongoDB transaction when available; fall back to
 * running `fn(null)` (no session) when transactions aren't supported by the
 * deployed Mongo instance (e.g. standalone mongod, no replica set).
 *
 * Why this exists: every multi-write financial operation in this codebase used
 * to be a series of independent writes inside try/catch + logger.error. On
 * failure between writes, half the change persisted (silent ledger drift).
 * With this wrapper, the whole `fn` either commits or aborts atomically — on
 * cluster setups that support transactions.
 *
 * On standalone Mongo we degrade gracefully: the writes still run, but the
 * caller is responsible for noticing if multi-doc atomicity matters. The
 * warning is logged once on the first fallback.
 */

let _supported = null;     // tri-state: null = unknown, true/false once probed
let _warnedOnce = false;

const probeOnce = async () => {
  if (_supported !== null) return _supported;
  let session;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      // empty body — just exercise the transaction machinery
    });
    _supported = true;
  } catch (err) {
    _supported = false;
    if (!_warnedOnce) {
      logger.warn(
        '[withTransaction] MongoDB transactions are NOT available on this instance ' +
        `(${err.message}). Falling back to non-transactional execution. ` +
        'Multi-document atomicity is NOT guaranteed — deploy a replica set ' +
        'for full crash-safety.'
      );
      _warnedOnce = true;
    }
  } finally {
    if (session) session.endSession();
  }
  return _supported;
};

/**
 * @template T
 * @param {(session: import('mongoose').ClientSession | null) => Promise<T>} fn
 * @returns {Promise<T>}
 */
const withTransaction = async (fn) => {
  const supported = await probeOnce();
  if (!supported) {
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    session.endSession();
  }
};

/** Test-only: reset the probe cache. */
const _resetProbe = () => {
  _supported = null;
  _warnedOnce = false;
};

module.exports = { withTransaction, _resetProbe };
