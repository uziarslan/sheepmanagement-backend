const mongoose = require('mongoose');

const salaryPaymentSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee is required']
    },
    month: {
      type: Number,
      required: [true, 'Month is required'],
      min: [1, 'Month must be between 1 and 12'],
      max: [12, 'Month must be between 1 and 12']
    },
    year: {
      type: Number,
      required: [true, 'Year is required'],
      min: [2000, 'Year must be 2000 or later']
    },
    basicSalary: {
      type: Number,
      required: [true, 'Basic salary is required'],
      min: [0, 'Basic salary cannot be negative']
    },
    allowances: {
      type: Number,
      default: 0,
      min: [0, 'Allowances cannot be negative']
    },
    grossSalary: {
      type: Number,
      required: [true, 'Gross salary is required'],
      min: [0, 'Gross salary cannot be negative']
    },
    advanceDeduction: {
      type: Number,
      default: 0,
      min: [0, 'Advance deduction cannot be negative']
    },
    otherDeductions: {
      type: Number,
      default: 0,
      min: [0, 'Other deductions cannot be negative']
    },
    // Extra amount added to the final paycheck (bonus, settlement, etc.).
    additionalAmount: {
      type: Number,
      default: 0,
      min: [0, 'Additional amount cannot be negative']
    },
    netSalary: {
      type: Number,
      required: [true, 'Net salary is required'],
      min: [0, 'Net salary cannot be negative']
    },
    // Prorated / partial payment (e.g. employee left mid-month and is paid
    // only for the days worked). When false, basic/allowances are the full
    // month figures from the employee master.
    isPartial: {
      type: Boolean,
      default: false
    },
    payableDays: {
      type: Number,
      min: [0, 'Payable days cannot be negative']
    },
    daysInMonth: {
      type: Number,
      min: [1, 'Days in month must be at least 1'],
      max: [31, 'Days in month cannot exceed 31']
    },
    paymentDate: {
      type: Date,
      required: [true, 'Payment date is required'],
      default: Date.now
    },
    paymentMode: {
      type: String,
      enum: ['Cash', 'Bank Transfer', 'Cheque', 'Other'],
      default: 'Cash'
    },
    notes: {
      type: String,
      maxlength: [500, 'Notes cannot exceed 500 characters']
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
salaryPaymentSchema.index({ employee: 1, year: 1, month: 1 }, { unique: true });
salaryPaymentSchema.index({ paymentDate: -1 });

const SalaryPayment = mongoose.model('SalaryPayment', salaryPaymentSchema);

module.exports = SalaryPayment;

