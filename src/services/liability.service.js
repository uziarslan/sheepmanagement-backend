const { Liability, Capital } = require('../models');
const logger = require('../utils/logger');
const {
  ApiError,
  getPaginationOptions,
  getSortOptions,
  getPaginationMeta,
  logAction,
  withTransaction
} = require('../utils');

/**
 * Get all liabilities with filters
 */
const getAll = async (query, _userId) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  // Farm-wide: liabilities are shared across all users in this deployment.
  const filter = {};
  if (query.lenderName) {
    // Escape regex metacharacters so user input can't inject a catastrophic
    // pattern (ReDoS) — matches how getByLender/getLenderOutstanding already
    // escape in this file. Preserves the contains/case-insensitive behavior.
    const escaped = String(query.lenderName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.lenderName = new RegExp(escaped, 'i');
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
const getByLender = async (lenderName, _userId) => {
  const name = (lenderName || '').trim();
  return Liability.find({ lenderName: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } })
    .sort({ date: -1 })
    .lean();
};

/**
 * Get lender balances (outstanding per lender)
 */
const getLenderBalances = async (_userId) => {
  const transactions = await Liability.find({}).lean();

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
const getLenderOutstanding = async (lenderName, _userId) => {
  const name = (lenderName || '').trim();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRegex = new RegExp(`^\\s*${escaped}\\s*$`, 'i');

  const borrowed = await Liability.aggregate([
    { $match: { lenderName: { $regex: nameRegex }, type: 'Borrowed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const returned = await Liability.aggregate([
    { $match: { lenderName: { $regex: nameRegex }, type: 'Returned' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  const totalBorrowed = borrowed[0]?.total || 0;
  const totalReturned = returned[0]?.total || 0;
  return totalBorrowed - totalReturned;
};

/**
 * Create liability record and update capital.
 * Atomic: liability insert + capital write commit together. Earlier code did
 * a "create then capital, on failure delete the liability" dance — fragile if
 * the cleanup itself failed. The transaction makes this a no-op on failure.
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

  const liability = await withTransaction(async (session) => {
    const [created] = await Liability.create(
      [{ ...liabilityData, createdBy: userId }],
      session ? { session } : {}
    );

    const amount = liabilityData.type === 'Borrowed' ? liabilityData.amount : -liabilityData.amount;
    const txType = liabilityData.type === 'Borrowed' ? 'Loan Borrowed' : 'Loan Returned';
    const desc = liabilityData.type === 'Borrowed'
      ? `Loan from ${liabilityData.lenderName}`
      : `Loan return to ${liabilityData.lenderName}`;

    const result = await Capital.atomicAddTransaction({
      amount,
      type: txType,
      description: desc,
      reference: String(created._id),
      createdBy: userId
    }, session);
    if (!result) {
      throw ApiError.badRequest(
        'Capital not initialized. Initialize capital before recording liabilities.'
      );
    }

    return created;
  });

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
 * Delete liability. Atomically reverses the original capital posting (a
 * 'Liability Reversal' of the opposite sign) and deletes the record together.
 */
const remove = async (id, userId) => {
  const liability = await Liability.findOne({ _id: id });
  if (!liability) {
    throw ApiError.notFound('Liability record not found');
  }

  // Atomic: capital reversal + liability delete commit together.
  // Sign rule (audit L2): reversal is the opposite of the original posting.
  await withTransaction(async (session) => {
    const reversalAmount = liability.type === 'Borrowed'
      ? -liability.amount
      : liability.amount;
    const description = `Liability reversal - ${liability.type} from/to ${liability.lenderName}`;

    await Capital.atomicAddTransaction({
      amount: reversalAmount,
      type: 'Liability Reversal',
      description,
      reference: String(liability._id),
      createdBy: userId
    }, session);

    await Liability.findByIdAndDelete(id, session ? { session } : {});
  });

  logAction({
    userId,
    action: 'Liability Deleted',
    entityType: 'Liability',
    entityId: liability._id,
    metadata: {
      lenderName: liability.lenderName,
      type: liability.type,
      amount: liability.amount
    }
  });

  return liability;
};

/**
 * Get summary (totals from all transactions; date filter optional for reporting)
 */
const getSummary = async (_userId, startDate, endDate) => {
  const match = {};
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
  const lenderBalances = await getLenderBalances();
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
