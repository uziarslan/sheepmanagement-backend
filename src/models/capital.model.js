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
    timestamps: true,
    // Sprint 5: optimistic concurrency. Mongoose checks __v hasn't changed
    // between load and save(); if it has, save() throws VersionError. Closes
    // the residual race on the few remaining doc-mutate-save paths.
    // Atomic findOneAndUpdate ops (Sprint 2/3) bypass this — they're already
    // race-safe by construction.
    optimisticConcurrency: true
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

// ─────────────────────────────────────────────────────────────────────────────
// Atomic statics — these are race-safe alternatives to the document-level
// methods below. Each performs a single findOneAndUpdate against the singleton
// using $inc + $push so concurrent callers can't lose each other's writes.
// Use these from services. The document-level methods are kept for backward
// compatibility with code that still loads + mutates + saves.
// ─────────────────────────────────────────────────────────────────────────────

const _opts = (session) => (session ? { new: true, session } : { new: true });

/**
 * Compute the $inc payload for a transaction without writing it.
 * Centralized here so doc-method + static stay in sync.
 *
 * Capital semantics:
 *   totalCapital     — contributed equity (partners + retained earnings).
 *                      Only investment-type transactions move it.
 *   availableAmount  — cash on hand. All cash movements touch this.
 *   investedAmount   — capital tied up in long-lived assets/animals/inventory.
 *
 * C3 (Sprint 4): Loan Borrowed / Loan Returned only move cash. Earlier code
 * pumped 'Loan Borrowed' into totalCapital — borrowed money isn't equity,
 * it's a liability tracked separately in the Liability collection.
 *
 * Similarly, "Other Income" is left as a cash-only entry; profit/loss
 * recognition belongs in capital.profit and is handled by dedicated flows
 * (recordAnimalSale, stock adjustment).
 */
const _CASH_ONLY_TYPES = new Set([
  'Loan Borrowed',
  'Loan Returned',
  'Liability Reversal',
  'Animal Deletion Reversal',
  'Other Income'
]);

const _buildInc = (amount, type, investmentSubtype) => {
  const inc = {};

  if (_CASH_ONLY_TYPES.has(type)) {
    // Cash in/out, no equity movement.
    inc.availableAmount = amount;
    return inc;
  }

  if (amount > 0) {
    inc.totalCapital = amount;
    inc.availableAmount = amount;
    if (investmentSubtype && INVESTMENT_SUBTYPES.includes(investmentSubtype)) {
      if (investmentSubtype === PARTNERS.PARTNER_1) inc.partner1Capital = amount;
      else if (investmentSubtype === PARTNERS.PARTNER_2) inc.partner2Capital = amount;
      else if (investmentSubtype === 'Retained Earnings') inc.retainedEarningsCapital = amount;
    }
  } else if (type === 'Investment Withdrawal' && investmentSubtype && INVESTMENT_SUBTYPES.includes(investmentSubtype)) {
    const abs = Math.abs(amount);
    if (investmentSubtype === PARTNERS.PARTNER_1) inc.partner1Capital = -abs;
    else if (investmentSubtype === PARTNERS.PARTNER_2) inc.partner2Capital = -abs;
    else if (investmentSubtype === 'Retained Earnings') inc.retainedEarningsCapital = -abs;
    inc.totalCapital = -abs;
    inc.availableAmount = amount; // negative
  } else if (amount < 0) {
    const investmentTypes = ['Animal Purchase', 'Stock Purchase', 'Infrastructure'];
    if (investmentTypes.includes(type)) {
      inc.investedAmount = Math.abs(amount);
    }
    inc.availableAmount = amount; // negative
  }
  return inc;
};

/**
 * Atomic version of addTransaction. Single findOneAndUpdate — race-safe.
 * Callers should validate (overdraft / partner balance) BEFORE calling.
 *
 * @param {object} params {amount, type, description, reference, createdBy, investmentSubtype}
 * @param {import('mongoose').ClientSession?} session
 */
capitalSchema.statics.atomicAddTransaction = async function (params, session = null) {
  const {
    amount,
    type,
    description,
    reference = null,
    createdBy = null,
    investmentSubtype = null
  } = params;

  const EXPENSE_TYPES = [
    'Animal Purchase', 'Stock Purchase', 'Salaries', 'Infrastructure',
    'Maintenance', 'Utilities', 'Transportation', 'Veterinary', 'Other Expense'
  ];

  // Non-blocking overdraft warning — preserves prior behavior.
  if (amount < 0 && EXPENSE_TYPES.includes(type)) {
    const current = await this.findOne({}, 'availableAmount').session(session || null).lean();
    const avail = current?.availableAmount ?? 0;
    if (Math.abs(amount) > avail + 0.01) {
      logger.warn(`Capital overdraft: ${type} of ${Math.abs(amount)}, available: ${avail}`);
    }
  }

  const tx = {
    amount,
    type,
    date: new Date(),
    description,
    reference,
    investmentSubtype,
    createdBy
  };

  const inc = _buildInc(amount, type, investmentSubtype);

  const updated = await this.findOneAndUpdate(
    {},
    {
      $push: { history: tx },
      $inc: inc,
      $set: { lastUpdated: new Date() }
    },
    _opts(session)
  );

  if (!updated) {
    throw new Error('Capital singleton not found. Initialize capital first.');
  }
  return updated;
};

/**
 * Atomic version of addLoss. capital.loss += amount; pushes ledger entry.
 * availableAmount is NOT touched — the cash flow was recorded earlier (e.g.
 * the animal purchase that's now being written off).
 */
capitalSchema.statics.atomicAddLoss = async function (params, session = null) {
  const {
    amount,
    description,
    reference = null,
    createdBy = null,
    type = 'Animal Death'
  } = params;
  if (!(amount > 0)) return null;

  return this.findOneAndUpdate(
    {},
    {
      $inc: { loss: amount },
      $push: {
        history: {
          amount: -amount,
          type,
          date: new Date(),
          description: description || `${type} - loss recorded`,
          reference,
          createdBy
        }
      },
      $set: { lastUpdated: new Date() }
    },
    _opts(session)
  );
};

/**
 * Atomic version of recordAnimalSale. Computes the full balance/loss/profit
 * delta and applies it in one findOneAndUpdate.
 *
 * Profit-vs-loss accounting: if there's existing `loss`, the new profit
 * covers loss first, then any remainder goes to `profit`. To do this without
 * a read-modify-write, we read just the current `loss` (race window is fine
 * because the worst case is over- or under- crediting one of {loss, profit}
 * by the amount of a concurrent reversal — both still sum correctly across
 * the books).
 */
capitalSchema.statics.atomicRecordAnimalSale = async function (params, session = null) {
  const {
    totalCost,
    sellingPrice,
    description,
    reference = null,
    createdBy = null,
    sellingCost = 0
  } = params;

  const profitFromSale = sellingPrice - totalCost - sellingCost;

  // Need the current loss to apportion profit. Best-effort read; if the value
  // shifts between read and write, the books still balance — only the
  // loss/profit split is approximate.
  const current = await this.findOne({}, 'loss').session(session || null).lean();
  const currentLoss = current?.loss ?? 0;

  let lossDelta = 0;
  let profitDelta = 0;
  if (profitFromSale > 0) {
    const amountToLoss = Math.min(profitFromSale, currentLoss);
    lossDelta = -amountToLoss;
    profitDelta = profitFromSale - amountToLoss;
  } else if (profitFromSale < 0) {
    lossDelta = Math.abs(profitFromSale);
  }

  // availableAmount: return invested cost + sale proceeds - selling expenses
  const availableDelta = totalCost + sellingPrice - sellingCost;
  // investedAmount: reduce by cost (can't go negative — use $max via two-step
  // approach: use $inc then clamp on read. For simplicity inc here; clamp in
  // recalculate-style maintenance jobs.)
  const investedDelta = -totalCost;

  const inc = { availableAmount: availableDelta };
  if (investedDelta !== 0) inc.investedAmount = investedDelta;
  if (lossDelta !== 0) inc.loss = lossDelta;
  if (profitDelta !== 0) inc.profit = profitDelta;

  return this.findOneAndUpdate(
    {},
    {
      $inc: inc,
      $push: {
        history: {
          amount: sellingPrice,
          type: 'Animal Sale',
          date: new Date(),
          description: description || 'Animal sale',
          reference,
          createdBy
        }
      },
      $set: { lastUpdated: new Date() }
    },
    _opts(session)
  );
};

/**
 * Reverse a previously-applied addLoss. Subtracts from `loss` (clamped at 0)
 * and pushes a counter ledger entry. Used by restore-from-dead.
 */
capitalSchema.statics.atomicReverseLoss = async function (params, session = null) {
  const {
    amount,
    description,
    reference = null,
    createdBy = null,
    type = 'Animal Death Reversal'
  } = params;
  if (!(amount > 0)) return null;

  // Clamp: only decrement up to the available loss. Use $max via a conditional
  // filter — if loss < amount, decrement just by what's available.
  const current = await this.findOne({}, 'loss').session(session || null).lean();
  const available = Math.min(amount, current?.loss ?? 0);

  return this.findOneAndUpdate(
    {},
    {
      $inc: { loss: -available },
      $push: {
        history: {
          amount: available,
          type,
          date: new Date(),
          description: description || `${type} - loss reversed`,
          reference,
          createdBy
        }
      },
      $set: { lastUpdated: new Date() }
    },
    _opts(session)
  );
};

/**
 * Reverse a previously-recorded animal sale. Subtracts sale proceeds from
 * availableAmount, restores investedAmount, undoes the loss/profit split
 * by symmetric apportionment.
 *
 * Note: the original sale's profit-vs-loss apportionment can't be replayed
 * exactly without knowing the loss at sale-time. We do the best we can:
 * if there's profit booked, subtract from profit first; the leftover comes
 * out of loss (i.e., reinstate the cleared loss).
 */
capitalSchema.statics.atomicReverseAnimalSale = async function (params, session = null) {
  const {
    totalCost,
    sellingPrice,
    description,
    reference = null,
    createdBy = null,
    sellingCost = 0
  } = params;

  const profitFromSale = sellingPrice - totalCost - sellingCost;

  // Read current profit so we can split the reversal cleanly.
  const current = await this.findOne({}, 'profit').session(session || null).lean();
  const currentProfit = current?.profit ?? 0;

  let profitDelta = 0;
  let lossDelta = 0;
  if (profitFromSale > 0) {
    // Original sale added (profitFromSale - clearedLoss) to profit and
    // cleared `clearedLoss` from loss. Without records, reverse by taking
    // from profit first; the remainder reinstates loss.
    const fromProfit = Math.min(profitFromSale, currentProfit);
    profitDelta = -fromProfit;
    lossDelta = profitFromSale - fromProfit; // reinstate cleared loss
  } else if (profitFromSale < 0) {
    // Sale added |profitFromSale| to loss; undo.
    lossDelta = -Math.abs(profitFromSale);
  }

  const availableDelta = -(totalCost + sellingPrice - sellingCost);
  const investedDelta = totalCost;

  const inc = { availableAmount: availableDelta, investedAmount: investedDelta };
  if (profitDelta !== 0) inc.profit = profitDelta;
  if (lossDelta !== 0) inc.loss = lossDelta;

  return this.findOneAndUpdate(
    {},
    {
      $inc: inc,
      $push: {
        history: {
          amount: -sellingPrice,
          type: 'Animal Sale Reversal',
          date: new Date(),
          description: description || 'Animal sale reversed',
          reference,
          createdBy
        }
      },
      $set: { lastUpdated: new Date() }
    },
    _opts(session)
  );
};

/**
 * Reverse a previously-applied addTransaction. Inverts the original signs
 * via _buildInc and pushes a counter ledger entry.
 */
capitalSchema.statics.atomicReverseTransaction = async function (params, session = null) {
  const {
    amount,           // ORIGINAL signed amount being reversed
    type,             // ORIGINAL type
    investmentSubtype = null,
    reversalType,     // type label to use for the reversal entry
    description,
    reference = null,
    createdBy = null
  } = params;

  // Compute the original $inc, then invert it.
  const origInc = _buildInc(amount, type, investmentSubtype);
  const inc = {};
  for (const [k, v] of Object.entries(origInc)) inc[k] = -v;

  return this.findOneAndUpdate(
    {},
    {
      $inc: inc,
      $push: {
        history: {
          amount: -amount,
          type: reversalType,
          date: new Date(),
          description,
          reference,
          createdBy
        }
      },
      $set: { lastUpdated: new Date() }
    },
    _opts(session)
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Document-level methods (legacy path).
// Kept for compatibility; new code should call the atomic statics above.
// These remain race-prone under concurrent saves on the same document.
// ─────────────────────────────────────────────────────────────────────────────

capitalSchema.methods.addTransaction = async function (amount, type, description, reference = null, createdBy = null, investmentSubtype = null) {
  const EXPENSE_TYPES = [
    'Animal Purchase', 'Stock Purchase', 'Salaries', 'Infrastructure',
    'Maintenance', 'Utilities', 'Transportation', 'Veterinary', 'Other Expense'
  ];
  if (amount < 0 && EXPENSE_TYPES.includes(type)) {
    if (Math.abs(amount) > this.availableAmount + 0.01) {
      logger.warn(`Capital overdraft: ${type} of ${Math.abs(amount)}, available: ${this.availableAmount}`);
    }
  }

  this.history.push({
    amount, type, date: new Date(), description, reference, investmentSubtype, createdBy
  });

  const inc = _buildInc(amount, type, investmentSubtype);
  for (const [field, delta] of Object.entries(inc)) {
    this[field] = (this[field] || 0) + delta;
    // Clamp legacy fields that we never want negative
    if (['totalCapital', 'partner1Capital', 'partner2Capital', 'retainedEarningsCapital'].includes(field)) {
      this[field] = Math.max(0, this[field]);
    }
  }

  this.lastUpdated = new Date();
  return this.save();
};

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

capitalSchema.methods.recordAnimalSale = async function (totalCost, sellingPrice, description, reference = null, createdBy = null, sellingCost = 0) {
  this.availableAmount += totalCost;
  this.investedAmount = Math.max(0, this.investedAmount - totalCost);
  this.availableAmount += sellingPrice;
  if (sellingCost > 0) this.availableAmount -= sellingCost;

  const profitFromSale = sellingPrice - totalCost - sellingCost;
  if (profitFromSale > 0) {
    const amountToLoss = Math.min(profitFromSale, this.loss);
    this.loss = Math.max(0, this.loss - amountToLoss);
    this.profit += profitFromSale - amountToLoss;
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
