const mongoose = require('mongoose');
const { CAPITAL_TRANSACTION_TYPES } = require('../constants');

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
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes
capitalSchema.index({ user: 1 });

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
capitalSchema.methods.addTransaction = async function (amount, type, description, reference = null, createdBy = null) {
  const transaction = {
    amount,
    type,
    date: new Date(),
    description,
    reference,
    createdBy
  };
  
  this.history.push(transaction);
  
  // Update totals
  if (amount > 0) {
    this.totalCapital += amount;
    this.availableAmount += amount;
  } else {
    this.investedAmount += Math.abs(amount);
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
  const profitFromSale = sellingPrice - totalCost - sellingCost;

  // Return cost to available balance and reduce invested
  this.availableAmount += totalCost;
  this.investedAmount = Math.max(0, this.investedAmount - totalCost);
  // Deduct selling cost (our expense)
  if (sellingCost > 0) {
    this.availableAmount -= sellingCost;
  }

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
    description: description || `Animal sale - cost returned ${totalCost}, sale ${sellingPrice}`,
    reference,
    createdBy
  });
  this.lastUpdated = new Date();
  return this.save();
};

// Method to set initial capital
capitalSchema.methods.setInitialCapital = async function (amount, createdBy = null) {
  this.totalCapital = amount;
  this.availableAmount = amount;
  this.investedAmount = 0;
  this.profit = 0;
  this.loss = 0;
  this.history = [{
    amount,
    type: 'Initial Investment',
    date: new Date(),
    description: 'Initial capital investment',
    createdBy
  }];
  this.lastUpdated = new Date();
  
  return this.save();
};

// Static method to get or create capital for user
capitalSchema.statics.getOrCreate = async function (userId) {
  let capital = await this.findOne({ user: userId });
  
  if (!capital) {
    capital = await this.create({
      user: userId,
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

// Static method to get summary
capitalSchema.statics.getSummary = async function (userId) {
  const capital = await this.findOne({ user: userId });
  
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

  return {
    totalCapital: capital.totalCapital,
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
