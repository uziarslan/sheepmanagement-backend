const mongoose = require('mongoose');
const { BCS_VALUES } = require('../constants');

const bcsRecordSchema = new mongoose.Schema(
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
    bcsScore: {
      type: Number,
      required: [true, 'BCS score is required'],
      enum: BCS_VALUES
    },
    previousBcsScore: {
      type: Number,
      enum: [...BCS_VALUES, null]
    },
    previousBcsDate: Date,
    bcsChange: {
      type: Number,
      default: 0
    },
    lastCalving: Date,
    lactationNo: {
      type: Number,
      min: 0
    },
    dimAge: {
      type: Number, // Days in Milk or Age in days
      min: 0
    },
    notes: {
      type: String,
      maxlength: [500, 'Notes cannot exceed 500 characters']
    },
    assessedBy: {
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
  }
);

// Indexes
bcsRecordSchema.index({ animal: 1, date: -1 });
bcsRecordSchema.index({ date: -1 });
bcsRecordSchema.index({ bcsScore: 1 });

// Pre-save middleware to calculate BCS change
bcsRecordSchema.pre('save', async function (next) {
  if (this.isNew) {
    // Get previous BCS record for this animal
    const previousRecord = await this.constructor
      .findOne({ animal: this.animal })
      .sort({ date: -1 });
    
    if (previousRecord) {
      this.previousBcsScore = previousRecord.bcsScore;
      this.previousBcsDate = previousRecord.date;
      this.bcsChange = this.bcsScore - previousRecord.bcsScore;
    }
  }
  next();
});

// Virtual for BCS category
bcsRecordSchema.virtual('bcsCategory').get(function () {
  // For 1-10 scale: <=4 under, 5-7 optimal, >7 over
  if (this.bcsScore <= 4) return 'Under-conditioned';
  if (this.bcsScore <= 7) return 'Optimal';
  return 'Over-conditioned';
});

// Static method to get animals with low BCS
bcsRecordSchema.statics.getLowBcsAnimals = async function (threshold = 4) {
  // Get latest BCS for each animal
  const latestBcs = await this.aggregate([
    { $sort: { animal: 1, date: -1 } },
    {
      $group: {
        _id: '$animal',
        latestBcs: { $first: '$$ROOT' }
      }
    },
    {
      $match: { 'latestBcs.bcsScore': { $lte: threshold } }
    },
    {
      $lookup: {
        from: 'animals',
        localField: '_id',
        foreignField: '_id',
        as: 'animalInfo'
      }
    },
    { $unwind: '$animalInfo' }
  ]);
  
  return latestBcs;
};

// Static method to get BCS history for animal
bcsRecordSchema.statics.getAnimalHistory = async function (animalId) {
  return this.find({ animal: animalId })
    .sort({ date: -1 })
    .limit(50);
};

const BcsRecord = mongoose.model('BcsRecord', bcsRecordSchema);

module.exports = BcsRecord;
