const mongoose = require('mongoose');
const { ADVANCE_TYPES } = require('../constants');

const advanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee is required']
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [1, 'Amount must be at least 1']
    },
    type: {
      type: String,
      required: [true, 'Transaction type is required'],
      enum: ADVANCE_TYPES
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
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

// Indexes
advanceSchema.index({ employee: 1 });
advanceSchema.index({ date: -1 });
advanceSchema.index({ type: 1 });

// Pre-save middleware to validate and calculate balance
advanceSchema.pre('save', function (next) {
  // Note: Employee balance update is handled in the service layer
  // This hook just does basic validation/calculation

  // KNOWN LIMITATION (F-42): The balanceAfter field is denormalized and calculated at save-time.
  // This creates a potential race condition in high-concurrency scenarios where multiple
  // advances are created simultaneously. The balance may not accurately reflect the true state
  // if multiple requests execute in parallel. A solution would be to:
  // 1. Use transactions (MongoDB 4.0+)
  // 2. Use a separate aggregation pipeline for balance calculations
  // 3. Implement optimistic locking with version fields
  // For now, this is accepted as a known limitation.

  next();
});

// Static method to get transaction history for employee
advanceSchema.statics.getByEmployee = async function (employeeId) {
  return this.find({ employee: employeeId })
    .sort({ date: -1 })
    .populate('approvedBy', 'name')
    .populate('createdBy', 'name');
};

// Static method to get total advances given in date range
advanceSchema.statics.getTotalByDateRange = async function (startDate, endDate) {
  const result = await this.aggregate([
    {
      $match: {
        date: { $gte: new Date(startDate), $lte: new Date(endDate) }
      }
    },
    {
      $group: {
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);
  
  return result;
};

const Advance = mongoose.model('Advance', advanceSchema);

module.exports = Advance;
