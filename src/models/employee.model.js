const mongoose = require('mongoose');
const {
  DEPARTMENTS,
  DESIGNATIONS,
  BANKS,
  EMPLOYEE_STATUSES
} = require('../constants');

const employeeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    cnic: {
      type: String,
      required: [true, 'CNIC is required'],
      unique: true,
      trim: true,
      match: [/^\d{5}-\d{7}-\d{1}$/, 'Please provide a valid CNIC (e.g., 35201-1234567-1)']
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
    },
    address: {
      type: String,
      trim: true,
      maxlength: [500, 'Address cannot exceed 500 characters']
    },
    designation: {
      type: String,
      required: [true, 'Designation is required'],
      enum: DESIGNATIONS
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      enum: DEPARTMENTS
    },
    dateOfJoining: {
      type: Date,
      required: [true, 'Date of joining is required']
    },
    dateOfLeaving: {
      type: Date
    },
    leavingReason: {
      type: String,
      trim: true,
      maxlength: [1000, 'Leaving reason cannot exceed 1000 characters']
    },
    salary: {
      type: Number,
      required: [true, 'Salary is required'],
      min: [0, 'Salary cannot be negative']
    },
    allowances: {
      type: Number,
      default: 0,
      min: [0, 'Allowances cannot be negative']
    },
    bankName: {
      type: String,
      enum: [...BANKS, ''],
      default: ''
    },
    accountNumber: {
      type: String,
      trim: true
    },
    advanceBalance: {
      type: Number,
      default: 0,
      min: [0, 'Advance balance cannot be negative']
    },
    status: {
      type: String,
      enum: EMPLOYEE_STATUSES,
      default: 'Active'
    },
    emergencyContact: {
      name: String,
      phone: String,
      relation: String
    },
    documents: [{
      name: String,
      url: String,
      uploadedAt: { type: Date, default: Date.now }
    }],
    picture: {
      type: String,
      default: null
    },
    notes: {
      type: String,
      maxlength: [1000, 'Notes cannot exceed 1000 characters']
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true,
    // Sprint 5: optimistic concurrency for legacy doc-mutate-save advance
    // balance flows. Atomic helpers (utils/atomic.js) bypass this — they're
    // already race-safe by construction.
    optimisticConcurrency: true
  }
);

// Indexes
employeeSchema.index({ cnic: 1 });
employeeSchema.index({ department: 1 });
employeeSchema.index({ status: 1 });
employeeSchema.index({ name: 'text' });

// Virtual for total compensation
employeeSchema.virtual('totalCompensation').get(function () {
  return this.salary + this.allowances;
});

// Virtual for tenure in months
employeeSchema.virtual('tenureMonths').get(function () {
  if (!this.dateOfJoining) return 0;
  const joinDate = this.dateOfJoining instanceof Date ? this.dateOfJoining : new Date(this.dateOfJoining);
  const endDate = this.dateOfLeaving ? (this.dateOfLeaving instanceof Date ? this.dateOfLeaving : new Date(this.dateOfLeaving)) : new Date();
  const months = (endDate.getFullYear() - joinDate.getFullYear()) * 12 +
    (endDate.getMonth() - joinDate.getMonth());
  return months;
});

// Virtual for advances
employeeSchema.virtual('advances', {
  ref: 'Advance',
  localField: '_id',
  foreignField: 'employee'
});

// Static method to get employees with outstanding advances
employeeSchema.statics.getWithOutstandingAdvances = async function () {
  return this.find({
    status: 'Active',
    advanceBalance: { $gt: 0 }
  }).sort({ advanceBalance: -1 });
};

// Method to add advance
employeeSchema.methods.addAdvance = async function (amount) {
  this.advanceBalance += amount;
  return this.save();
};

// Method to deduct advance
employeeSchema.methods.deductAdvance = async function (amount) {
  if (amount > this.advanceBalance) {
    throw new Error(`Deduction amount exceeds advance balance. Current balance: ${this.advanceBalance}`);
  }
  this.advanceBalance -= amount;
  return this.save();
};

const Employee = mongoose.model('Employee', employeeSchema);

module.exports = Employee;
