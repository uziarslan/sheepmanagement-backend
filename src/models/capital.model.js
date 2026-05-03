const mongoose = require('mongoose');
const { CAPITAL_TRANSACTION_TYPES, INVESTMENT_SUBTYPES, PARTNERS } = require('../constants');
const logger = require('../utils/logger');

const transactionSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: CAPITAL_TRANSACTION_TYPES
  },
  investmentSubtype: {
    type: String,
    enum: INVESTMENT_SUBTYPES,
    default: null
  },
  date: {
    type: Date,
    default: Date.now
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  reference: {
    type: String // Reference to related document (animal purchase, sale, etc.)
  },
  invoiceUrl: {
    type: String // Cloudinary URL for uploaded invoice
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

const capitalSchema = new mongoose.Schema(
  {
    totalCapital: {
      type: Number,
      default: 0,
      min: 0
    },
    partner1Capital: { type: Number, default: 0, min: 0 },
    partner2Capital: { type: Number, default: 0, min: 0 },
    retainedEarningsCapital: { type: Number, default: 0, min: 0 },
    investedAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    availableAmount: {
      type: Number,
      default: 0
    },
    profit: {
      type: Number,
      default: 0,
      min: 0
    },
    loss: {
      type: Number,
      default: 0,
      min: 0
    },
    history: [transactionSchema],
    lastUpdated: {
      type: Date,
      default: Date.now
    },
    // Legacy field — kept optional for backward compatibility with existing data.
    // Capital is farm-wide (single deployment = single farm); not used for scoping queries.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false
    }
  },
  {
    timestamps: true
  }
);

// Virtual for total income
capitalSchema.virtual('totalIncome').get(function () {
  return this.history
    .filter(t => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
});

// Virtual for total expenses
capitalSchema.virtual('totalExpenses').get(function () {
  return this.history
    .filter(t => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
});

// Method to add transaction
capitalSchema.methods.addTransaction = async function (amount, type, description, reference = null, createdBy = null, investmentSubtype = null) {
  // Guard against overdraft for expense transactions
  const EXPENSE_TYPES = [
    'Animal Purchase', 'Stock Purchase', 'Salaries', 'Infrastructure',
    'Maintenance', 'Utilities', 'Transportation', 'Veterinary', 'Other Expense'
  ];
  if (amount < 0 && EXPENSE_TYPES.includes(type)) {
    if (Math.abs(amount) > this.availableAmount + 0.01) {
      // Log warning but don't throw — capital can go negative for system-generated transactions
      // but record it so it can be reconciled
      logger.warn(`Capital overdraft: ${type} of ${Math.abs(amount)}, available: ${this.availableAmount}`);
    }
  }

  const transaction = {
    amount,
    type,
    date: new Date(),
    description,
    reference,
    investmentSubtype,
    createdBy
  };

  this.history.push(transaction);

  // Update totals
  if (amount > 0) {
    this.totalCapital += amount;
    this.availableAmount += amount;
    // Update subdivision for investment types (Additional Investment)
    if (investmentSubtype && INVESTMENT_SUBTYPES.includes(investmentSubtype)) {
      if (investmentSubtype === PARTNERS.PARTNER_1) this.partner1Capital = (this.partner1Capital || 0) + amount;
      else if (investmentSubtype === PARTNERS.PARTNER_2) this.partner2Capital = (this.partner2Capital || 0) + amount;
      else if (investmentSubtype === 'Retained Earnings') this.retainedEarningsCapital = (this.retainedEarningsCapital || 0) + amount;
    }
  } else if (type === 'Investment Withdrawal' && investmentSubtype && INVESTMENT_SUBTYPES.includes(investmentSubtype)) {
    // Deduct from specific subdivision and totals
    const absAmount = Math.abs(amount);
    if (investmentSubtype === PARTNERS.PARTNER_1) {
      this.partner1Capital = Math.max(0, (this.partner1Capital || 0) - absAmount);
    } else if (investmentSubtype === PARTNERS.PARTNER_2) {
      this.partner2Capital = Math.max(0, (this.partner2Capital || 0) - absAmount);
    } else if (investmentSubtype === 'Retained Earnings') {
      this.retainedEarningsCapital = Math.max(0, (this.retainedEarningsCapital || 0) - absAmount);
    }
    this.totalCapital = Math.max(0, this.totalCapital - absAmount);
    this.availableAmount += amount; // amount is negative
  } else if (amount < 0) {
    // Only increment investedAmount for specific investment types
    const investmentTypes = ['Animal Purchase', 'Stock Purchase', 'Infrastructure'];
    if (investmentTypes.includes(type)) {
      this.investedAmount += Math.abs(amount);
    }
    this.availableAmount += amount; // amount is negative
  }

  this.lastUpdated = new Date();

  return this.save();
};

/**
 * Record loss from dead animal (full cost goes to loss; no balance change)
 */
capitalSchema.methods.addLoss = async function (amount, description, reference = null, createdBy = null) {
  if (amount <= 0) return this;
  this.loss += amount;
  this.history.push({
    amount: -amount,
    type: 'Animal Death',
    date: new Date(),
    description: description || 'Animal death - loss recorded',
    reference,
    createdBy
  });
  this.lastUpdated = new Date();
  return this.save();
};

/**
 * Record animal sale: return cost to available balance, then apply profit to loss then to profit
 * sellingCost = our expense (transport, commission) - reduces profit
 */
capitalSchema.methods.recordAnimalSale = async function (totalCost, sellingPrice, description, reference = null, createdBy = null, sellingCost = 0) {
  // Return invested cost to available and reduce investedAmount
  this.availableAmount += totalCost;
  this.investedAmount = Math.max(0, this.investedAmount - totalCost);

  // Add actual cash received from sale
  this.availableAmount += sellingPrice;

  // Deduct selling expenses
  if (sellingCost > 0) {
    this.availableAmount -= sellingCost;
  }

  const profitFromSale = sellingPrice - totalCost - sellingCost;

  if (profitFromSale > 0) {
    const amountToLoss = Math.min(profitFromSale, this.loss);
    const amountToProfit = profitFromSale - amountToLoss;
    this.loss = Math.max(0, this.loss - amountToLoss);
    this.profit += amountToProfit;
  } else if (profitFromSale < 0) {
    this.loss += Math.abs(profitFromSale);
  }

  this.history.push({
    amount: sellingPrice,
    type: 'Animal Sale',
    date: new Date(),
    description: description || 'Animal sale',
    reference,
    createdBy
  });
  this.lastUpdated = new Date();
  return this.save();
};

// Method to set initial capital (with subdivision breakdown)
capitalSchema.methods.setInitialCapital = async function (partner1, partner2, retainedEarnings, createdBy = null) {
  const total = (partner1 || 0) + (partner2 || 0) + (retainedEarnings || 0);
  this.totalCapital = total;
  this.availableAmount = total;
  this.investedAmount = 0;
  this.profit = 0;
  this.loss = 0;
  this.partner1Capital = partner1 || 0;
  this.partner2Capital = partner2 || 0;
  this.retainedEarningsCapital = retainedEarnings || 0;

  // Add 3 transaction entries for clear history
  const now = new Date();
  if (partner1 > 0) {
    this.history.push({
      amount: partner1,
      type: 'Initial Investment',
      investmentSubtype: PARTNERS.PARTNER_1,
      date: now,
      description: `Initial capital - ${PARTNERS.PARTNER_1}`,
      createdBy
    });
  }
  if (partner2 > 0) {
    this.history.push({
      amount: partner2,
      type: 'Initial Investment',
      investmentSubtype: PARTNERS.PARTNER_2,
      date: now,
      description: `Initial capital - ${PARTNERS.PARTNER_2}`,
      createdBy
    });
  }
  if (retainedEarnings > 0) {
    this.history.push({
      amount: retainedEarnings,
      type: 'Initial Investment',
      investmentSubtype: 'Retained Earnings',
      date: now,
      description: 'Initial capital - Retained Earnings',
      createdBy
    });
  }

  this.lastUpdated = now;
  return this.save();
};

// Static method to get or create the farm-wide capital singleton.
// `userId` is accepted for signature compatibility but only used as `createdBy` audit
// when the singleton is created for the first time.
capitalSchema.statics.getOrCreate = async function (userId) {
  let capital = await this.findOne({});

  if (!capital) {
    capital = await this.create({
      user: userId || undefined,
      totalCapital: 0,
      investedAmount: 0,
      availableAmount: 0,
      profit: 0,
      loss: 0,
      history: []
    });
  }

  return capital;
};

// Static method to get summary (farm-wide singleton)
capitalSchema.statics.getSummary = async function (_userId) {
  const capital = await this.findOne({});
  
  if (!capital) {
    return {
      totalCapital: 0,
      investedAmount: 0,
      availableAmount: 0,
      profit: 0,
      loss: 0,
      totalIncome: 0,
      totalExpenses: 0
    };
  }

  // Backward compat: legacy records without subdivision show total as Retained Earnings
  const p1 = capital.partner1Capital ?? 0;
  const p2 = capital.partner2Capital ?? 0;
  const re = capital.retainedEarningsCapital ?? 0;
  const hasSubdivision = p1 + p2 + re > 0;

  return {
    totalCapital: capital.totalCapital,
    partner1Capital: p1,
    partner2Capital: p2,
    retainedEarningsCapital: hasSubdivision ? re : capital.totalCapital,
    investedAmount: capital.investedAmount,
    availableAmount: capital.availableAmount,
    profit: capital.profit ?? 0,
    loss: capital.loss ?? 0,
    totalIncome: capital.totalIncome,
    totalExpenses: capital.totalExpenses,
    lastUpdated: capital.lastUpdated,
    recentTransactions: capital.history.slice(-10).reverse()
  };
};

const Capital = mongoose.model('Capital', capitalSchema);

module.exports = Capital;
