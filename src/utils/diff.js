/**
 * Compute a shallow before/after diff between two objects.
 *
 * AL3 (Sprint 5): update-audit entries used to store the raw incoming
 * request body, which doesn't tell a forensic reader WHAT actually changed
 * (e.g., a request that says `{ pen: 'X', name: 'Alpha' }` may have been a
 * no-op if both were already those values). This helper records only the
 * fields whose value actually moved, as `{ field: { from, to } }`.
 *
 * Notes:
 *  - Comparison is JSON-string equality, which handles Date/ObjectId by
 *    coercing to string. Good enough for audit fields; for binary blobs use
 *    something else.
 *  - `keys` lets the caller restrict the comparison to fields they care
 *    about — useful so we don't audit Mongoose-internal noise.
 *  - Always returns `null` if no field differs; the caller can choose to
 *    skip writing an audit entry in that case.
 *
 * @param {object} before
 * @param {object} after
 * @param {string[]?} keys  If provided, only these fields are diffed.
 */
const diffFields = (before, after, keys = null) => {
  const fieldList = keys || Array.from(new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {})
  ]));

  const out = {};
  for (const k of fieldList) {
    const a = before?.[k];
    const b = after?.[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out[k] = { from: a ?? null, to: b ?? null };
    }
  }
  return Object.keys(out).length ? out : null;
};

module.exports = { diffFields };
