/**
 * Canonical animal-cost helpers.
 *
 * These are the SINGLE source of truth for "how much has been spent on an
 * animal". Previously this sum was hand-rolled in 8 places across
 * animal.service.js (create/bulkCreate/declareDead/markAsSold/bulkMarkAsSold/
 * restoreFromDead/restoreFromSold/remove) with two structurally-different
 * variants (one relying on the Mongoose `totalPurchaseCost` virtual, one
 * re-expanding the fields manually for `.lean()` objects). Adding a new
 * purchase-expense field meant editing every site or silently mis-booking
 * capital. (Audit finding M-4.)
 *
 * All helpers operate on a PLAIN object (works for both hydrated Mongoose docs
 * and `.lean()` results), so callers never depend on virtuals being present.
 *
 * Accounting model (cost-basis P&L — see capital.model.js header):
 *   purchaseCost     = purchase price + the 5 purchasing expenses. This is the
 *                      ONLY part that is capitalised into Capital.investedAmount
 *                      and released back to availableAmount on sale/delete.
 *   operationalCost  = feed + health + vaccination + deworming + salary. These
 *                      are realised as P&L (profit/loss) only; they never move
 *                      availableAmount/investedAmount at sale time because the
 *                      cash already left earlier (salary expense / stock
 *                      purchase) or never was cash.
 *   totalCost        = purchaseCost + operationalCost (full economic basis used
 *                      for profit/loss).
 */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** Purchase price + the 5 purchasing expenses (transport/mandi/fuel/food/hotel). */
const purchaseCost = (a) =>
  num(a && a.purchasePrice) +
  num(a && a.purchaseTransport) +
  num(a && a.purchaseMandiExpenses) +
  num(a && a.purchaseFuel) +
  num(a && a.purchaseFood) +
  num(a && a.purchaseHotel);

/** Feed + health + vaccination + deworming + salary costs accrued on the animal. */
const operationalCost = (a) =>
  num(a && a.totalFeedCost) +
  num(a && a.totalHealthCost) +
  num(a && a.totalVaccinationCost) +
  num(a && a.totalDewormingCost) +
  num(a && a.totalSalaryCost);

/** Full economic cost basis = purchase + operational. */
const totalCost = (a) => purchaseCost(a) + operationalCost(a);

module.exports = { purchaseCost, operationalCost, totalCost };
