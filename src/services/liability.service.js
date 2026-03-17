const mongoose = require('mongoose');
const { Liability, Capital } = require('../models');
const logger = require('../utils/logger');
const { ApiError, getPaginationOptions, getSortOptions, getPaginationMeta, logAction } = require('../utils');

/**
 * Get all liabilities with filters
 */
const getAll = async (query, userId) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  const filter = { user: userId };
  if (query.lenderName) {
    filter.lenderName = new RegExp(query.lenderName, 'i');
  }
  if (query.type) filter.type = query.type;

  if (query.startDate || query.endDate) {
    filter.date = {};
    if (query.startDate) filter.date.$gte = new Date(query.startDate);
    if (query.endDate) filter.date.$lte = new Date(query.endDate);
  }

  const [liabilities, total] = await Promise.all([
    Liability.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Liability.countDocuments(filter)
  ]);

  return {
    data: liabilities,
    meta: getPaginationMeta(total, page, limit)
  };
};

/**
 * Get liabilities by lender name (exact match, case-insensitive)
 */
const getByLender = async (lenderName, userId) => {
  const name = (lenderName || '').trim();
  return Liability.find({ lenderName: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, user: userId })
    .sort({ date: -1 })
    .lean();
};

/**
 * Get lender balances (outstanding per lender)
 */
const getLenderBalances = async (userId) => {
  const transactions = await Liability.find({ user: userId }).lean();

  const balances = {};
  for (const t of transactions) {
    const name = t.lenderName;
    if (!balances[name]) balances[name] = 0;
    if (t.type === 'Borrowed') {
      balances[name] += t.amount;
    } else {
      balances[name] -= t.amount;
    }
  }

  return Object.entries(balances)
    .filter(([, balance]) => balance > 0)
    .map(([lenderName, balance]) => ({ lenderName, balance }))
    .sort((a, b) => b.balance - a.balance);
};

/**
 * Get current outstanding for a lender
 */
const getLenderOutstanding = async (lenderName, userId) => {
  const name = (lenderName || '').trim();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRegex = new RegExp(`^\\s*${escaped}\\s*$`, 'i');
  // Aggregate pipelines don't auto-cast strings to ObjectId — cast explicitly
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const borrowed = await Liability.aggregate([
    { $match: { lenderName: { $regex: nameRegex }, user: userObjectId, type: 'Borrowed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const returned = await Liability.aggregate([
    { $match: { lenderName: { $regex: nameRegex }, user: userObjectId, type: 'Returned' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  const totalBorrowed = borrowed[0]?.total || 0;
  const totalReturned = returned[0]?.total || 0;
  return totalBorrowed - totalReturned;
};

/**
 * Create liability record and update capital
 */
const create = async (liabilityData, userId) => {
  if (liabilityData.type === 'Returned') {
    const outstanding = await getLenderOutstanding(liabilityData.lenderName, userId);
    if (liabilityData.amount > outstanding) {
      throw ApiError.badRequest(
        `Return amount exceeds current balance. Outstanding: Rs.${outstanding.toLocaleString()}`
      );
    }
  }

  const liability = await Liability.create({
    ...liabilityData,
    user: userId,
    createdBy: userId
  });

  // Update capital: Borrow -> add to balance, Return -> deduct
  try {
    const capital = await Capital.findOne({ user: userId });
    if (capital) {
      const amount = liabilityData.type === 'Borrowed' ? liabilityData.amount : -liabilityData.amount;
      const txType = liabilityData.type === 'Borrowed' ? 'Loan Borrowed' : 'Loan Returned';
      const desc = liabilityData.type === 'Borrowed'
        ? `Loan from ${liabilityData.lenderName}`
        : `Loan return to ${liabilityData.lenderName}`;
      await capital.addTransaction(amount, txType, desc, liability._id, userId);
    }
  } catch (error) {
    logger.error('Failed to update capital for liability:', error);
    await Liability.findByIdAndDelete(liability._id);
    throw ApiError.internal('Failed to record capital. Please try again.');
  }

  logAction({
    userId,
    action: 'Liability Created',
    entityType: 'Liability',
    entityId: liability._id,
    metadata: {
      lenderName: liabilityData.lenderName,
      amount: liabilityData.amount,
      type: liabilityData.type
    }
  });

  return liability;
};

/**
 * Delete liability (does not reverse capital - use with caution)
 */
const remove = async (id, userId) => {
  const liability = await Liability.findOne({ _id: id, user: userId });
  if (!liability) {
    throw ApiError.notFound('Liability record not found');
  }

  // Reverse the capital transaction before deleting
  try {
    const capital = await Capital.getOrCreate(userId);
    // Reverse the original transaction by adding back the liability amount
    const description = `Liability reversal - ${liability.type} (${liability.description || ''})`;
    await capital.addTransaction(liability.amount, 'Liability Reversal', description, String(liability._id), userId);
  } catch (err) {
    // Log error but continue with deletion
    logger.error('Failed to reverse capital transaction for liability:', err.message || err);
  }

  await Liability.findByIdAndDelete(id);
  return liability;
};

/**
 * Get summary (totals from all transactions; date filter optional for reporting)
 */
const getSummary = async (userId, startDate, endDate) => {
  const match = { user: userId };
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }

  const summary = await Liability.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);

  const totalBorrowed = summary.find(s => s._id === 'Borrowed')?.total || 0;
  const totalReturned = summary.find(s => s._id === 'Returned')?.total || 0;
  const lenderBalances = await getLenderBalances(userId);
  const outstanding = lenderBalances.reduce((sum, l) => sum + l.balance, 0);

  return {
    totalBorrowed,
    totalReturned,
    outstanding,
    lenderCount: lenderBalances.length,
    lenders: lenderBalances
  };
};

module.exports = {
  getAll,
  getByLender,
  getLenderBalances,
  getLenderOutstanding,
  create,
  remove,
  getSummary
};
