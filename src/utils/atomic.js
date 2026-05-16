/**
 * Atomic single-document update helpers.
 *
 * Replaces the read-modify-write pattern (load doc → mutate field → save())
 * which races under concurrency. Each helper uses `findOneAndUpdate` with a
 * conditional filter (e.g. `currentQty >= quantity`) so the deduction either
 * succeeds atomically or returns null — no two parallel requests can both
 * succeed and drive a balance negative.
 *
 * All helpers accept an optional Mongoose session so they can participate in
 * a larger transaction.
 */

const mongoose = require('mongoose');
const ApiError = require('./ApiError');

const opts = (session) => (session ? { new: true, session } : { new: true });

/**
 * Atomically deduct `quantity` from a Stock document's `currentQty`.
 * Throws ApiError if the stock doesn't exist or has insufficient quantity.
 *
 * @param {string|mongoose.Types.ObjectId} stockId
 * @param {number} quantity must be > 0
 * @param {mongoose.ClientSession?} session
 */
const atomicDeductStock = async (stockId, quantity, session = null) => {
  if (!(quantity > 0)) {
    throw ApiError.badRequest(`Invalid deduct quantity: ${quantity}`);
  }
  const Stock = mongoose.model('Stock');
  const updated = await Stock.findOneAndUpdate(
    { _id: stockId, currentQty: { $gte: quantity } },
    { $inc: { currentQty: -quantity } },
    opts(session)
  );
  if (!updated) {
    // Distinguish "doesn't exist" from "insufficient" for a useful error.
    const exists = await Stock.findById(stockId, 'currentQty productName unit')
      .session(session || null)
      .lean();
    if (!exists) throw ApiError.notFound(`Stock ${stockId} not found`);
    throw ApiError.badRequest(
      `Insufficient stock for ${exists.productName}. ` +
      `Available: ${exists.currentQty} ${exists.unit}, required: ${quantity}`
    );
  }
  return updated;
};

/**
 * Atomically add `quantity` back to a Stock document. Used for reversals.
 */
const atomicAddStock = async (stockId, quantity, session = null) => {
  if (!(quantity > 0)) {
    throw ApiError.badRequest(`Invalid add quantity: ${quantity}`);
  }
  const Stock = mongoose.model('Stock');
  return Stock.findByIdAndUpdate(
    stockId,
    { $inc: { currentQty: quantity } },
    opts(session)
  );
};

/**
 * Atomically deduct `amount` from an Employee's advanceBalance.
 * Throws if balance is insufficient.
 */
const atomicDeductAdvance = async (employeeId, amount, session = null) => {
  if (!(amount > 0)) {
    throw ApiError.badRequest(`Invalid advance deduct amount: ${amount}`);
  }
  const Employee = mongoose.model('Employee');
  const updated = await Employee.findOneAndUpdate(
    { _id: employeeId, advanceBalance: { $gte: amount } },
    { $inc: { advanceBalance: -amount } },
    opts(session)
  );
  if (!updated) {
    const exists = await Employee.findById(employeeId, 'advanceBalance name')
      .session(session || null)
      .lean();
    if (!exists) throw ApiError.notFound('Employee not found');
    throw ApiError.badRequest(
      `Advance deduction exceeds balance. Available: ${exists.advanceBalance}`
    );
  }
  return updated;
};

/**
 * Atomically add `amount` to an Employee's advanceBalance.
 */
const atomicAddAdvance = async (employeeId, amount, session = null) => {
  if (!(amount > 0)) {
    throw ApiError.badRequest(`Invalid advance add amount: ${amount}`);
  }
  const Employee = mongoose.model('Employee');
  return Employee.findByIdAndUpdate(
    employeeId,
    { $inc: { advanceBalance: amount } },
    opts(session)
  );
};

module.exports = {
  atomicDeductStock,
  atomicAddStock,
  atomicDeductAdvance,
  atomicAddAdvance
};
