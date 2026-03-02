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
 * Initialize capital
 */
const initialize = async (userId, amount) => {
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

  await capital.setInitialCapital(amount, userId);

  return capital;
};

/**
 * Add transaction
 */
const addTransaction = async (userId, amount, type, description, reference = null) => {
  const capital = await Capital.findOne({ user: userId });

  if (!capital) {
    throw ApiError.notFound('Capital not initialized. Please set initial capital first.');
  }

  // Validate available amount for expenses
  if (amount < 0 && Math.abs(amount) > capital.availableAmount) {
    throw ApiError.badRequest(
      `Insufficient funds. Available: ${capital.availableAmount}`
    );
  }

  await capital.addTransaction(amount, type, description, reference, userId);

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
