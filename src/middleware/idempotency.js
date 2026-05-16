const { IdempotencyKey } = require('../models');
const logger = require('../utils/logger');

/**
 * Idempotency middleware.
 *
 * Activates only when the request carries an `Idempotency-Key` header. If
 * the header is absent, the middleware is a no-op (back-compat with any
 * client that hasn't been updated). When present, ensures that retrying a
 * request with the same key produces the same response without re-executing
 * side effects.
 *
 * Constraints:
 * - Keys must be 16–128 chars, URL-safe.
 * - Keys are scoped per (user, METHOD+path) so a UUID can't be replayed
 *   across different endpoints.
 * - In-flight collisions (same key reused before the first call finishes)
 *   return 409 — the client should wait and retry rather than mutate twice.
 *
 * Storage: MongoDB collection with TTL index; entries vanish after 24 h.
 */

const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;

const idempotency = async (req, res, next) => {
  const rawKey = req.headers['idempotency-key'];
  if (!rawKey) return next();

  if (!KEY_RE.test(rawKey)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid Idempotency-Key header (16-128 chars, [A-Za-z0-9_-] only).'
    });
  }

  const fingerprint = `${req.method} ${req.baseUrl}${req.route?.path || req.path}`;
  const userId = req.user?.id || req.user?._id || null;
  const filter = { key: rawKey, fingerprint, user: userId };

  // Claim the key atomically. Two cases worth distinguishing:
  //   - Upsert succeeded → first call, status=in-progress.
  //   - Existing doc → replay or 409.
  let existing;
  try {
    existing = await IdempotencyKey.findOneAndUpdate(
      filter,
      { $setOnInsert: { status: 'in-progress' } },
      { upsert: true, new: false, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // Duplicate-key races can theoretically happen on the unique index even
    // with upsert if two requests hit at the exact same instant. Treat as
    // existing-key path.
    if (err.code === 11000) {
      existing = await IdempotencyKey.findOne(filter);
    } else {
      logger.error('[idempotency] storage error, bypassing:', err.message || err);
      return next();
    }
  }

  if (existing) {
    if (existing.status === 'completed') {
      // Replay the stored response.
      return res.status(existing.statusCode || 200).json(existing.response);
    }
    if (existing.status === 'in-progress') {
      return res.status(409).json({
        success: false,
        message:
          'A request with this Idempotency-Key is currently in flight. Wait for it to finish before retrying.'
      });
    }
    if (existing.status === 'failed') {
      // Allow a fresh attempt: rewrite the record back to in-progress.
      await IdempotencyKey.updateOne(filter, { $set: { status: 'in-progress' } });
    }
  }

  // Intercept res.json so we can persist the response after the handler runs.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const statusCode = res.statusCode;
    const finalStatus = statusCode >= 200 && statusCode < 400 ? 'completed' : 'failed';
    // Persist asynchronously; do not block the response.
    IdempotencyKey.updateOne(
      filter,
      {
        $set: {
          status: finalStatus,
          statusCode,
          response: body
        }
      }
    ).catch((err) => {
      logger.error('[idempotency] failed to persist response:', err.message || err);
    });
    return originalJson(body);
  };

  next();
};

module.exports = idempotency;
