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
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
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
liabilitySchema.index({ lenderName: 1 });
liabilitySchema.index({ date: -1 });
liabilitySchema.index({ type: 1 });
liabilitySchema.index({ user: 1 });

const Liability = mongoose.model('Liability', liabilitySchema);

module.exports = Liability;
