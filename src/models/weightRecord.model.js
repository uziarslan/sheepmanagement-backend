const mongoose = require('mongoose');

const weightRecordSchema = new mongoose.Schema(
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
    weight: {
      type: Number,
      required: [true, 'Weight is required'],
      min: [0.1, 'Weight must be greater than 0']
    },
    previousWeight: {
      type: Number,
      default: 0
    },
    weightChange: {
      type: Number,
      default: 0
    },
    percentageChange: {
      type: Number,
      default: 0
    },
    notes: {
      type: String,
      maxlength: [500, 'Notes cannot exceed 500 characters']
    },
    recordedBy: {
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
weightRecordSchema.index({ animal: 1, date: -1 });
weightRecordSchema.index({ date: -1 });

// Pre-save middleware to calculate weight change
weightRecordSchema.pre('save', async function (next) {
  if (this.isNew) {
    // Get previous weight record for this animal
    const previousRecord = await this.constructor
      .findOne({ animal: this.animal })
      .sort({ date: -1 });
    
    if (previousRecord) {
      this.previousWeight = previousRecord.weight;
      this.weightChange = this.weight - previousRecord.weight;
      this.percentageChange = previousRecord.weight > 0 
        ? ((this.weightChange / previousRecord.weight) * 100).toFixed(2)
        : 0;
    } else {
      // First record - get from animal
      const Animal = mongoose.model('Animal');
      const animal = await Animal.findById(this.animal);
      if (animal) {
        this.previousWeight = animal.weight;
        this.weightChange = this.weight - animal.weight;
        this.percentageChange = animal.weight > 0
          ? ((this.weightChange / animal.weight) * 100).toFixed(2)
          : 0;
      }
    }
    
    // Update animal's current weight
    const Animal = mongoose.model('Animal');
    await Animal.findByIdAndUpdate(this.animal, {
      weight: this.weight,
      weightDate: this.date
    });
  }
  next();
});

// Static method to get weight history for animal
weightRecordSchema.statics.getAnimalHistory = async function (animalId) {
  return this.find({ animal: animalId })
    .sort({ date: -1 })
    .limit(50);
};

// Static method to get average daily gain for animal
weightRecordSchema.statics.getAverageDailyGain = async function (animalId, startDate, endDate) {
  const records = await this.find({
    animal: animalId,
    date: { $gte: new Date(startDate), $lte: new Date(endDate) }
  }).sort({ date: 1 });
  
  if (records.length < 2) return 0;
  
  const firstRecord = records[0];
  const lastRecord = records[records.length - 1];
  const daysDiff = Math.ceil((lastRecord.date - firstRecord.date) / (1000 * 60 * 60 * 24));
  
  if (daysDiff === 0) return 0;
  
  return ((lastRecord.weight - firstRecord.weight) / daysDiff).toFixed(2);
};

const WeightRecord = mongoose.model('WeightRecord', weightRecordSchema);

module.exports = WeightRecord;
