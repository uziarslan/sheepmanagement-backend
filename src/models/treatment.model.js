const mongoose = require('mongoose');
const { TREATMENT_TYPES, DIAGNOSIS_TYPES, CURE_STATUSES } = require('../constants');

const treatmentMedicineSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stock',
    required: true
  },
  medicineName: String,
  rate: Number,
  unit: String,
  quantity: {
    type: Number,
    required: true,
    min: [0.001, 'Quantity must be greater than 0']
  },
  total: Number
}, { _id: false });

const treatmentSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: [true, 'Treatment date is required'],
      default: Date.now
    },
    animal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Animal',
      required: [true, 'Animal is required']
    },
    animalTagId: String,
    animalName: String,
    findings: {
      type: String,
      maxlength: [1000, 'Findings cannot exceed 1000 characters']
    },
    type: {
      type: String,
      required: [true, 'Treatment type is required'],
      enum: TREATMENT_TYPES
    },
    diagnosis: {
      type: String,
      required: [true, 'Diagnosis is required'],
      enum: DIAGNOSIS_TYPES
    },
    medicines: [treatmentMedicineSchema],
    totalAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    duration: {
      type: Number, // Duration in days
      min: [1, 'Duration must be at least 1 day']
    },
    expectedEndDate: Date,
    cureStatus: {
      type: String,
      enum: CURE_STATUSES,
      default: 'In Treatment'
    },
    curedDate: Date,
    followUpDate: Date,
    veterinarian: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    veterinarianName: String,
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
    timestamps: true,
  }
);

// Indexes
treatmentSchema.index({ date: -1 });
treatmentSchema.index({ animal: 1 });
treatmentSchema.index({ cureStatus: 1 });
treatmentSchema.index({ diagnosis: 1 });

// Pre-save middleware
treatmentSchema.pre('save', function (next) {
  // Calculate expected end date
  if (this.duration && this.date) {
    this.expectedEndDate = new Date(this.date.getTime() + this.duration * 24 * 60 * 60 * 1000);
  }

  // Calculate total amount for new treatments
  if (this.isNew && this.medicines && this.medicines.length > 0) {
    this.totalAmount = this.medicines.reduce((sum, med) => sum + (med.total || 0), 0);
  }

  next();
});

// Static method to get uncured treatments
treatmentSchema.statics.getUncured = async function () {
  return this.find({ cureStatus: { $in: ['In Treatment', 'Uncured'] } })
    .populate('animal', 'tagId name')
    .populate('veterinarian', 'name')
    .sort({ date: -1 });
};

// Static method to get treatments by status and date range
treatmentSchema.statics.getByStatusAndDateRange = async function (status, startDate, endDate) {
  const query = {
    date: { $gte: new Date(startDate), $lte: new Date(endDate) }
  };
  
  if (status && status !== 'Both') {
    query.cureStatus = status;
  }
  
  return this.find(query)
    .populate('animal', 'tagId name')
    .populate('veterinarian', 'name')
    .sort({ date: -1 });
};

// Method to mark as cured
treatmentSchema.methods.markAsCured = async function () {
  this.cureStatus = 'Cured';
  this.curedDate = new Date();
  return this.save();
};

const Treatment = mongoose.model('Treatment', treatmentSchema);

module.exports = Treatment;
