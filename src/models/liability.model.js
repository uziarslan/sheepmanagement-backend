const mongoose = require('mongoose');
const { LIABILITY_TYPES } = require('../constants');

const liabilitySchema = new mongoose.Schema(
  {
    lenderName: {
      type: String,
      required: [true, 'Lender name is required'],
      trim: true,
      maxlength: [200, 'Lender name cannot exceed 200 characters']
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [1, 'Amount must be at least 1']
    },
    type: {
      type: String,
      required: [true, 'Transaction type is required'],
      enum: LIABILITY_TYPES
    },
    date: {
      type: Date,
      required: [true, 'Date is required'],
      default: Date.now
    },
    notes: {
      type: String,
      maxlength: [500, 'Notes cannot exceed 500 characters']
    },
    balanceAfter: {
      type: Number,
      default: 0
    },
    // Legacy field — kept optional. Liability is farm-wide
    // (single deployment = single farm); not used for scoping queries.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true,
  }
);

// Indexes
liabilitySchema.index({ lenderName: 1 });
liabilitySchema.index({ date: -1 });
liabilitySchema.index({ type: 1 });

// Pre-save middleware
// KNOWN LIMITATION (F-42): The balanceAfter field is denormalized and calculated at save-time.
// This creates a potential race condition in high-concurrency scenarios where multiple
// liabilities are created simultaneously. The balance may not accurately reflect the true state
// if multiple requests execute in parallel. A solution would be to:
// 1. Use transactions (MongoDB 4.0+)
// 2. Use a separate aggregation pipeline for balance calculations
// 3. Implement optimistic locking with version fields
// For now, this is accepted as a known limitation.
liabilitySchema.pre('save', function (next) {
  next();
});

const Liability = mongoose.model('Liability', liabilitySchema);

module.exports = Liability;
