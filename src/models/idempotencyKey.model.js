const mongoose = require('mongoose');

/**
 * Idempotency keys for safe POST/PUT retries.
 *
 * Flow:
 *   1. Client sends `Idempotency-Key: <uuid>` header on a mutating request.
 *   2. Middleware tries `findOneAndUpdate` with upsert to claim the key.
 *      - If brand-new: marks status=in-progress, lets the request through.
 *      - If already exists with a stored response: replays it (no side effects).
 *      - If exists in-progress: 409 (another in-flight call with same key).
 *   3. After the handler runs, middleware writes the response back.
 *
 * The TTL index drops entries 24 h after creation; that's the retry window.
 */
const idempotencyKeySchema = new mongoose.Schema(
  {
    // Composite identity: user-scoped so two users can't collide on the same key.
    key: { type: String, required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // The route fingerprint: METHOD + path. Different endpoints with the same
    // key are treated as separate operations — guards against accidental
    // cross-endpoint replay if the client reuses a UUID.
    fingerprint: { type: String, required: true },

    status: {
      type: String,
      enum: ['in-progress', 'completed', 'failed'],
      default: 'in-progress'
    },

    // Stored response — replayed verbatim when the key is reused.
    statusCode: Number,
    response: mongoose.Schema.Types.Mixed,

    expiresAt: {
      type: Date,
      // Default = 24 h from creation; TTL index below removes the doc then.
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  },
  { timestamps: true }
);

// One key per (user, key, fingerprint) tuple.
idempotencyKeySchema.index(
  { user: 1, key: 1, fingerprint: 1 },
  { unique: true }
);
// TTL — Mongo will purge documents after `expiresAt` passes.
idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('IdempotencyKey', idempotencyKeySchema);
