const mongoose = require('mongoose');
const { SHEARING_TYPES } = require('../constants');

const shearingRecordSchema = new mongoose.Schema(
  {
    animal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Animal',
      required: [true, 'Animal is required']
    },
    animalTagId: String,
    animalName: String,
    date: {
      type: Date,
      required: [true, 'Date is required'],
      default: Date.now
    },
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    technicianName: String,
    shearingType: {
      type: String,
      required: [true, 'Shearing type is required'],
      enum: SHEARING_TYPES
    },
    woolWeight: {
      type: Number,
      default: 0,
      min: [0, 'Wool weight cannot be negative']
    },
    woolQuality: {
      type: String,
      enum: ['Excellent', 'Good', 'Average', 'Poor'],
      default: 'Good'
    },
    cost: {
      type: Number,
      default: 0,
      min: [0, 'Cost cannot be negative']
    },
    nextShearingDate: Date,
    comments: {
      type: String,
      maxlength: [1000, 'Comments cannot exceed 1000 characters']
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
shearingRecordSchema.index({ animal: 1, date: -1 });
shearingRecordSchema.index({ date: -1 });
shearingRecordSchema.index({ shearingType: 1 });
shearingRecordSchema.index({ technician: 1 });

// Pre-save middleware to update animal health cost
shearingRecordSchema.pre('save', async function (next) {
  if (this.isNew && this.cost > 0) {
    const Animal = mongoose.model('Animal');
    await Animal.findByIdAndUpdate(this.animal, {
      $inc: { totalHealthCost: this.cost }
    });
  }
  next();
});

module.exports = mongoose.model('ShearingRecord', shearingRecordSchema);
