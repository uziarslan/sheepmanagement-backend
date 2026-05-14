/**
 * Capital reconciliation — recompute the singleton's denormalised fields
 * (totalCapital, partner subdivisions, availableAmount, investedAmount,
 * profit, loss) from the authoritative `history` array.
 *
 * Why this exists:
 *  - Pre-Sprint 4 bug (C3): 'Loan Borrowed' transactions inflated
 *    `totalCapital`. Deployments that took out loans will have a `totalCapital`
 *    higher than the partners actually contributed.
 *  - Pre-Sprint 2: the singleton was mutated via `history.push + save()`.
 *    Concurrent writes could silently drop entries — leaving denormalised
 *    totals out-of-sync with `history`.
 *  - Future maintenance: any time the model semantics change, re-running this
 *    script restores the invariant `denormalised == fold(history)`.
 *
 * Usage:
 *   node src/scripts/reconcile-capital.js          # report only
 *   node src/scripts/reconcile-capital.js --fix    # write corrections
 *
 * The report mode is safe — it only reads. `--fix` writes the recomputed
 * values to the singleton in one atomic findOneAndUpdate.
 */

const mongoose = require('mongoose');
const { connectDB } = require('../config');
const { Capital } = require('../models');
const { PARTNERS, INVESTMENT_SUBTYPES } = require('../constants');
const logger = require('../utils/logger');

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Types that move equity (totalCapital + partner subdivisions).
// Mirrors the rules in capital.model.js#_buildInc — keep in sync if those change.
const _CASH_ONLY_TYPES = new Set([
  'Loan Borrowed',
  'Loan Returned',
  'Liability Reversal',
  'Animal Deletion Reversal',
  'Other Income'
]);

const INVESTMENT_TYPES = new Set(['Animal Purchase', 'Stock Purchase', 'Infrastructure']);

function foldHistory(history) {
  const out = {
    totalCapital: 0,
    partner1Capital: 0,
    partner2Capital: 0,
    retainedEarningsCapital: 0,
    availableAmount: 0,
    investedAmount: 0,
    profit: 0,
    loss: 0
  };

  for (const tx of history) {
    const amount = Number(tx.amount) || 0;
    const type = tx.type;
    const sub = tx.investmentSubtype;

    if (type === 'Animal Sale' || type === 'Animal Sale Reversal') {
      // These are emitted by recordAnimalSale / reverseAnimalSale, which mutate
      // availableAmount + investedAmount + profit/loss directly — not via
      // _buildInc. We can't reconstruct the profit/loss split from history
      // alone, so we account for the cash leg and skip the P&L split.
      // The current `profit`/`loss` values are kept; only fold what's
      // unambiguous from history.
      if (type === 'Animal Sale') {
        // amount in history = sellingPrice. The cost-return + selling-cost
        // legs aren't in history, so this is inherently lossy. Flagged in
        // the report.
        out.availableAmount += amount;
      } else {
        out.availableAmount -= amount;
      }
      continue;
    }

    if (type === 'Animal Death' || type === 'Animal Death Reversal') {
      // addLoss / reverseLoss only touch capital.loss. amount in history is
      // negative for addLoss, positive for reverseLoss.
      out.loss += -amount;
      continue;
    }

    if (type === 'Stock Adjustment') {
      // amount > 0 = write-up → +profit. amount < 0 = write-down → +loss.
      if (amount > 0) out.profit += amount;
      else out.loss += Math.abs(amount);
      continue;
    }

    if (type === 'Salary Reversal') {
      // _buildInc handles via reversal path (see atomicReverseTransaction).
      // amount in history is the reversed (positive) value.
      out.availableAmount += amount;
      continue;
    }

    if (_CASH_ONLY_TYPES.has(type)) {
      out.availableAmount += amount;
      continue;
    }

    if (amount > 0) {
      out.totalCapital += amount;
      out.availableAmount += amount;
      if (sub && INVESTMENT_SUBTYPES.includes(sub)) {
        if (sub === PARTNERS.PARTNER_1) out.partner1Capital += amount;
        else if (sub === PARTNERS.PARTNER_2) out.partner2Capital += amount;
        else if (sub === 'Retained Earnings') out.retainedEarningsCapital += amount;
      }
    } else if (type === 'Investment Withdrawal' && sub && INVESTMENT_SUBTYPES.includes(sub)) {
      const abs = Math.abs(amount);
      if (sub === PARTNERS.PARTNER_1) out.partner1Capital -= abs;
      else if (sub === PARTNERS.PARTNER_2) out.partner2Capital -= abs;
      else if (sub === 'Retained Earnings') out.retainedEarningsCapital -= abs;
      out.totalCapital -= abs;
      out.availableAmount += amount; // negative
    } else if (amount < 0) {
      if (INVESTMENT_TYPES.has(type)) {
        out.investedAmount += Math.abs(amount);
      }
      out.availableAmount += amount; // negative
    }
  }

  // Clamp to zero — historical totals must never go negative.
  for (const k of ['totalCapital', 'partner1Capital', 'partner2Capital',
    'retainedEarningsCapital', 'investedAmount', 'profit', 'loss']) {
    out[k] = Math.max(0, Number(out[k].toFixed(2)));
  }
  out.availableAmount = Number(out.availableAmount.toFixed(2));

  return out;
}

function printRow(label, current, recomputed) {
  const drift = (Number(recomputed) - Number(current)).toFixed(2);
  const marker = Math.abs(drift) >= 0.01 ? '←' : ' ';
  console.log(
    `  ${label.padEnd(28)} current=${fmt(current).padStart(14)}  ` +
    `recomputed=${fmt(recomputed).padStart(14)}  drift=${String(drift).padStart(12)} ${marker}`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');

  await connectDB();

  const capital = await Capital.findOne({});
  if (!capital) {
    console.log('No capital singleton found — nothing to reconcile.');
    await mongoose.connection.close();
    return;
  }

  console.log(`Capital singleton: ${capital._id}`);
  console.log(`History entries:   ${capital.history.length}`);
  console.log('');

  const recomputed = foldHistory(capital.history);

  console.log('Drift report (denormalised fields vs. fold over history):');
  printRow('totalCapital', capital.totalCapital, recomputed.totalCapital);
  printRow('partner1Capital', capital.partner1Capital, recomputed.partner1Capital);
  printRow('partner2Capital', capital.partner2Capital, recomputed.partner2Capital);
  printRow('retainedEarningsCapital', capital.retainedEarningsCapital, recomputed.retainedEarningsCapital);
  printRow('availableAmount', capital.availableAmount, recomputed.availableAmount);
  printRow('investedAmount', capital.investedAmount, recomputed.investedAmount);
  printRow('profit', capital.profit, recomputed.profit);
  printRow('loss', capital.loss, recomputed.loss);
  console.log('');

  console.log('Caveats:');
  console.log(' - profit/loss apportionment from Animal Sale txs is lossy in history.');
  console.log('   The fold accounts for the cash leg only; current profit/loss are kept.');
  console.log(' - If you see drift in profit/loss, prefer manual reconciliation over --fix.');
  console.log('');

  if (!fix) {
    console.log('(report only — pass --fix to write corrections)');
    await mongoose.connection.close();
    return;
  }

  // --- Fix mode: apply only the fields whose semantics are fully derivable.
  // We deliberately DO NOT overwrite profit/loss because the sale-time
  // apportionment isn't in history.
  const writable = {
    totalCapital: recomputed.totalCapital,
    partner1Capital: recomputed.partner1Capital,
    partner2Capital: recomputed.partner2Capital,
    retainedEarningsCapital: recomputed.retainedEarningsCapital,
    availableAmount: recomputed.availableAmount,
    investedAmount: recomputed.investedAmount,
    lastUpdated: new Date()
  };

  const result = await Capital.findOneAndUpdate(
    { _id: capital._id },
    { $set: writable },
    { new: true }
  );

  console.log('Applied fix. New values:');
  printRow('totalCapital', capital.totalCapital, result.totalCapital);
  printRow('partner1Capital', capital.partner1Capital, result.partner1Capital);
  printRow('partner2Capital', capital.partner2Capital, result.partner2Capital);
  printRow('retainedEarningsCapital', capital.retainedEarningsCapital, result.retainedEarningsCapital);
  printRow('availableAmount', capital.availableAmount, result.availableAmount);
  printRow('investedAmount', capital.investedAmount, result.investedAmount);
  console.log('(profit/loss intentionally left alone — see caveats above)');

  await mongoose.connection.close();
}

main().catch((err) => {
  logger.error('reconcile-capital failed:', err);
  process.exit(1);
});
