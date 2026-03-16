const mongoose = require('mongoose');
const { HOOF_DIAGNOSIS } = require('../constants');

const hoofDetailSchema = new mongoose.Schema({
  position: {
    type: String,
    enum: ['Front Left', 'Front Right', 'Rear Left', 'Rear Right'],
    required: true
  },
  condition: {
    type: String,
    enum: ['Normal', 'Mild Issue', 'Moderate Issue', 'Severe Issue'],
    default: 'Normal'
  },
  trimmed: {
    type: Boolean,
    default: false
  },
  notes: String
}, { _id: false });

const hoofRecordSchema = new mongoose.Schema(
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
    diagnosis: {
      type: String,
      required: [true, 'Diagnosis is required'],
      enum: HOOF_DIAGNOSIS
    },
    hoofDetails: {
      type: [hoofDetailSchema],
      default: [
        { position: 'Front Left', condition: 'Normal', trimmed: false },
        { position: 'Front Right', condition: 'Normal', trimmed: false },
        { position: 'Rear Left', condition: 'Normal', trimmed: false },
        { position: 'Rear Right', condition: 'Normal', trimmed: false }
      ]
    },
    cost: {
      type: Number,
      default: 0,
      min: [0, 'Cost cannot be negative']
    },
    treatmentApplied: String,
    nextCheckupDate: Date,
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
hoofRecordSchema.index({ animal: 1, date: -1 });
hoofRecordSchema.index({ date: -1 });
hoofRecordSchema.index({ diagnosis: 1 });
hoofRecordSchema.index({ technician: 1 });

// Pre-save middleware to update animal health cost
hoofRecordSchema.pre('save', async function (next) {
  if (this.isNew && this.cost > 0) {
    const Animal = mongoose.model('Animal');
    await Animal.findByIdAndUpdate(this.animal, {
      $inc: { totalHealthCost: this.cost }
    });
  }
  next();
});

// Static method to get upcoming checkups
hoofRecordSchema.statics.getUpcomingCheckups = async function (daysAhead = 7) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysAhead);
  
  return this.find({
    nextCheckupDate: { $lte: futureDate, $gte: new Date() }
  })
    .populate('animal', 'tagId name')
    .populate('technician', 'name')
    .sort({ nextCheckupDate: 1 });
};

// Static method to get records by diagnosis
hoofRecordSchema.statics.getByDiagnosis = async function (diagnosis) {
  return this.find({ diagnosis })
    .populate('animal', 'tagId name')
    .populate('technician', 'name')
    .sort({ date: -1 });
};

const HoofRecord = mongoose.model('HoofRecord', hoofRecordSchema);

module.exports = HoofRecord;
