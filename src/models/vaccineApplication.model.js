const mongoose = require('mongoose');
const { VACCINATION_SCOPES } = require('../constants');

const medicineUsedSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stock',
    required: true
  },
  medicineName: String,
  quantity: {
    type: Number,
    required: true,
    min: [0.001, 'Quantity must be greater than 0']
  },
  unit: String,
  rate: Number,
  total: Number
}, { _id: false });

const vaccineApplicationSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: [true, 'Application date is required'],
      default: Date.now
    },
    vaccineRecipe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VaccineRecipe',
      required: [true, 'Vaccine recipe is required']
    },
    vaccineName: String,
    disease: String,
    scope: {
      type: String,
      required: [true, 'Scope is required'],
      enum: VACCINATION_SCOPES
    },
    pen: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Pen'
    },
    penName: String,
    animal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Animal'
    },
    animals: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Animal'
    }],
    animalCount: {
      type: Number,
      default: 0
    },
    medicineUsed: {
      type: [medicineUsedSchema],
      required: true
    },
    totalCost: {
      type: Number,
      default: 0
    },
    nextDueDate: {
      type: Date
    },
    remarks: {
      type: String,
      trim: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    timestamps: true,
  }
);

// Indexes
vaccineApplicationSchema.index({ date: -1 });
vaccineApplicationSchema.index({ vaccineRecipe: 1 });
vaccineApplicationSchema.index({ scope: 1 });
vaccineApplicationSchema.index({ pen: 1 });
vaccineApplicationSchema.index({ animal: 1 });

const VaccineApplication = mongoose.model('VaccineApplication', vaccineApplicationSchema);

module.exports = VaccineApplication;
