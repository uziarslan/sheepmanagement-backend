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

// Method to set initial capital
capitalSchema.methods.setInitialCapital = async function (amount, createdBy = null) {
  this.totalCapital = amount;
  this.availableAmount = amount;
  this.investedAmount = 0;
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
      totalIncome: 0,
      totalExpenses: 0
    };
  }
  
  return {
    totalCapital: capital.totalCapital,
    investedAmount: capital.investedAmount,
    availableAmount: capital.availableAmount,
    totalIncome: capital.totalIncome,
    totalExpenses: capital.totalExpenses,
    lastUpdated: capital.lastUpdated,
    recentTransactions: capital.history.slice(-10).reverse()
  };
};

const Capital = mongoose.model('Capital', capitalSchema);

module.exports = Capital;
