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
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes
advanceSchema.index({ employee: 1 });
advanceSchema.index({ date: -1 });
advanceSchema.index({ type: 1 });

// Pre-save middleware to update employee balance
advanceSchema.pre('save', async function (next) {
  if (this.isNew) {
    const Employee = mongoose.model('Employee');
    const employee = await Employee.findById(this.employee);
    
    if (!employee) {
      return next(new Error('Employee not found'));
    }
    
    // Validate return amount
    if (this.type === 'Returned' && this.amount > employee.advanceBalance) {
      return next(new Error('Return amount cannot exceed current advance balance'));
    }
    
    // Update employee balance
    if (this.type === 'Given') {
      employee.advanceBalance += this.amount;
    } else {
      employee.advanceBalance -= this.amount;
    }
    
    await employee.save();
    this.balanceAfter = employee.advanceBalance;
  }
  
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
