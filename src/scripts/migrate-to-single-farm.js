/**
 * One-time migration: convert per-user Capital + Liability data to farm-wide.
 *
 * Why: This deployment model is one-farm-per-deployment. Capital and Liability
 * were originally scoped per user, so each user only saw their own data.
 * After this migration, all users in this deployment share a single capital
 * document and a single shared liability log.
 *
 * What it does:
 *   1. Drops the unique index on `capitals.user` (if it exists).
 *   2. Picks the capital doc with the longest `history` as the canonical
 *      farm-wide capital. Merges history from any other capital docs into it
 *      and deletes the duplicates. Recomputes totals from history.
 *   3. Removes the `user` field from all liabilities (no merging needed —
 *      they're individual records and now globally visible).
 *
 * Run once per deployment:
 *   node src/scripts/migrate-to-single-farm.js
 */

const mongoose = require('mongoose');
const { connectDB } = require('../config');
const { Capital, Liability } = require('../models');
const logger = require('../utils/logger');

const PARTNERS = { PARTNER_1: 'Partner1', PARTNER_2: 'Partner2' };
const RE = 'Retained Earnings';

async function dropUserUniqueIndex() {
  const indexes = await Capital.collection.indexes();
  for (const idx of indexes) {
    if (idx.key && idx.key.user === 1) {
      try {
        await Capital.collection.dropIndex(idx.name);
        logger.info(`Dropped index ${idx.name} on capitals.user`);
      } catch (e) {
        logger.warn(`Could not drop index ${idx.name}: ${e.message}`);
      }
    }
  }
}

function recomputeTotalsFromHistory(capital) {
  let totalCapital = 0;
  let availableAmount = 0;
  let investedAmount = 0;
  let profit = 0;
  let loss = 0;
  let p1 = 0, p2 = 0, re = 0;

  const investmentTypes = ['Animal Purchase', 'Stock Purchase', 'Infrastructure'];

  for (const t of capital.history) {
    const amt = t.amount;
    if (amt > 0) {
      totalCapital += amt;
      availableAmount += amt;
      if (t.investmentSubtype === PARTNERS.PARTNER_1) p1 += amt;
      else if (t.investmentSubtype === PARTNERS.PARTNER_2) p2 += amt;
      else if (t.investmentSubtype === RE) re += amt;
    } else if (t.type === 'Investment Withdrawal') {
      const a = Math.abs(amt);
      if (t.investmentSubtype === PARTNERS.PARTNER_1) p1 = Math.max(0, p1 - a);
      else if (t.investmentSubtype === PARTNERS.PARTNER_2) p2 = Math.max(0, p2 - a);
      else if (t.investmentSubtype === RE) re = Math.max(0, re - a);
      totalCapital = Math.max(0, totalCapital - a);
      availableAmount += amt;
    } else if (amt < 0) {
      if (investmentTypes.includes(t.type)) investedAmount += Math.abs(amt);
      availableAmount += amt;
      if (t.type === 'Animal Death') loss += Math.abs(amt);
    }
  }

  capital.totalCapital = totalCapital;
  capital.availableAmount = availableAmount;
  capital.investedAmount = investedAmount;
  capital.partner1Capital = p1;
  capital.partner2Capital = p2;
  capital.retainedEarningsCapital = re;
  capital.profit = profit;
  capital.loss = loss;
  capital.lastUpdated = new Date();
}

async function mergeCapitals() {
  const docs = await Capital.find({}).lean();
  if (docs.length <= 1) {
    logger.info(`Capital docs: ${docs.length}. Nothing to merge.`);
    return;
  }

  // Pick the doc with the longest history as canonical
  docs.sort((a, b) => (b.history?.length || 0) - (a.history?.length || 0));
  const canonicalId = docs[0]._id;
  const canonical = await Capital.findById(canonicalId);

  let mergedCount = 0;
  for (let i = 1; i < docs.length; i++) {
    const other = docs[i];
    if ((other.history || []).length > 0) {
      canonical.history.push(...other.history);
      mergedCount += other.history.length;
    }
    await Capital.findByIdAndDelete(other._id);
  }

  // Sort merged history by date ascending and recompute totals
  canonical.history.sort((a, b) => new Date(a.date) - new Date(b.date));
  recomputeTotalsFromHistory(canonical);
  canonical.user = undefined;
  await canonical.save();

  logger.info(
    `Merged ${docs.length} capital docs into 1 (kept ${canonicalId}, merged ${mergedCount} transactions, deleted ${docs.length - 1} duplicates).`
  );
}

async function unscopeLiabilities() {
  const result = await Liability.updateMany({}, { $unset: { user: '' } });
  logger.info(`Unscoped ${result.modifiedCount || 0} liability records (cleared user field).`);
}

async function run() {
  await connectDB();
  try {
    logger.info('Starting single-farm migration...');
    await dropUserUniqueIndex();
    await mergeCapitals();
    await unscopeLiabilities();
    logger.info('Migration complete.');
  } catch (err) {
    logger.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
