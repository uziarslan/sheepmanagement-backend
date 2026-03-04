const { Capital } = require('../models');
const { ApiError } = require('../utils');

/**
 * Get capital info for user
 */
const get = async (userId) => {
  const capital = await Capital.getOrCreate(userId);
  return capital;
};

/**
 * Initialize capital (with partner subdivisions)
 */
const initialize = async (userId, { partner1 = 0, partner2 = 0, retainedEarnings = 0 }) => {
  let capital = await Capital.findOne({ user: userId });

  if (capital && capital.history.length > 0) {
    throw ApiError.badRequest('Capital already initialized. Use update instead.');
  }

  if (!capital) {
    capital = await Capital.create({
      user: userId,
      totalCapital: 0,
      investedAmount: 0,
      availableAmount: 0,
      history: []
    });
  }

  await capital.setInitialCapital(partner1, partner2, retainedEarnings, userId);

  return capital;
};

/**
 * Add transaction
 * For type 'Additional Investment', investmentSubtype is required (Partner1, Partner2, or Retained Earnings)
 */
const addTransaction = async (userId, amount, type, description, reference = null, investmentSubtype = null) => {
  const capital = await Capital.findOne({ user: userId });

  if (!capital) {
    throw ApiError.notFound('Capital not initialized. Please set initial capital first.');
  }

  // Additional Investment must specify investment subtype
  if (type === 'Additional Investment' && amount > 0 && !investmentSubtype) {
    throw ApiError.badRequest('Please select investment type (Partner1, Partner2, or Retained Earnings).');
  }

  // Investment Withdrawal: must specify subtype; amount cannot exceed partner balance or available cash
  if (type === 'Investment Withdrawal') {
    if (!investmentSubtype) {
      throw ApiError.badRequest('Please select whose investment to deduct from.');
    }
    const absAmount = Math.abs(amount);
    const p1 = capital.partner1Capital || 0;
    const p2 = capital.partner2Capital || 0;
    const re = capital.retainedEarningsCapital || 0;
    const hasSubdivision = p1 + p2 + re > 0;
    let partnerBalance = 0;
    if (investmentSubtype === 'Partner1 (Imran Shah)') partnerBalance = p1;
    else if (investmentSubtype === 'Partner2 (Raza Abbas)') partnerBalance = p2;
    else if (investmentSubtype === 'Retained Earnings') partnerBalance = hasSubdivision ? re : capital.totalCapital || 0;
    if (absAmount > partnerBalance) {
      throw ApiError.badRequest(
        `Amount exceeds ${investmentSubtype} balance (Rs.${partnerBalance.toLocaleString()})`
      );
    }
    if (absAmount > capital.availableAmount) {
      throw ApiError.badRequest(
        `Insufficient cash to pay out. Available: Rs.${capital.availableAmount.toLocaleString()}`
      );
    }
  }

  // Validate available amount for other expense types
  if (amount < 0 && type !== 'Investment Withdrawal' && Math.abs(amount) > capital.availableAmount) {
    throw ApiError.badRequest(
      `Insufficient funds. Available: ${capital.availableAmount}`
    );
  }

  await capital.addTransaction(amount, type, description, reference, userId, investmentSubtype);

  return capital;
};

/**
 * Get transaction history
 */
const getTransactions = async (userId, query = {}) => {
  const capital = await Capital.findOne({ user: userId });

  if (!capital) {
    return { data: [], total: 0 };
  }

  let transactions = [...capital.history];

  // Filter by type
  if (query.type) {
    transactions = transactions.filter(t => t.type === query.type);
  }

  // Filter by date range
  if (query.startDate) {
    transactions = transactions.filter(t => new Date(t.date) >= new Date(query.startDate));
  }
  if (query.endDate) {
    transactions = transactions.filter(t => new Date(t.date) <= new Date(query.endDate));
  }

  // Sort by date descending
  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Pagination
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 50;
  const skip = (page - 1) * limit;

  const paginatedTransactions = transactions.slice(skip, skip + limit);

  return {
    data: paginatedTransactions,
    total: transactions.length,
    page,
    limit,
    totalPages: Math.ceil(transactions.length / limit)
  };
};

/**
 * Get capital summary
 */
const getSummary = async (userId) => {
  return Capital.getSummary(userId);
};

/**
 * Update transaction invoice URL
 */
const updateTransactionInvoice = async (userId, transactionId, invoiceUrl) => {
  const capital = await Capital.findOne({ user: userId });

  if (!capital) {
    throw ApiError.notFound('Capital not found.');
  }

  const transaction = capital.history.id(transactionId);
  if (!transaction) {
    throw ApiError.notFound('Transaction not found.');
  }

  transaction.invoiceUrl = invoiceUrl;
  await capital.save();

  return capital;
};

module.exports = {
  get,
  initialize,
  addTransaction,
  getTransactions,
  getSummary,
  updateTransactionInvoice
};
