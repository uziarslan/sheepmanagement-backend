const mongoose = require('mongoose');

const temperatureRecordSchema = new mongoose.Schema(
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
    temperature: {
      type: Number,
      required: [true, 'Temperature is required'],
      min: [20, 'Temperature must be greater than 20°C']
    },
    previousTemperature: {
      type: Number,
      default: 0
    },
    temperatureChange: {
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
  }
);

// Indexes
temperatureRecordSchema.index({ animal: 1, date: -1 });
temperatureRecordSchema.index({ date: -1 });

// Pre-save middleware to calculate temperature change
temperatureRecordSchema.pre('save', async function (next) {
  if (this.isNew) {
    const previousRecord = await this.constructor
      .findOne({ animal: this.animal })
      .sort({ date: -1 });

    if (previousRecord) {
      this.previousTemperature = previousRecord.temperature;
      this.temperatureChange = Number((this.temperature - previousRecord.temperature).toFixed(2));
    }
  }
  next();
});

// Static method to get temperature history for animal
temperatureRecordSchema.statics.getAnimalHistory = async function (animalId) {
  return this.find({ animal: animalId })
    .sort({ date: -1 })
    .limit(50);
};

const TemperatureRecord = mongoose.model('TemperatureRecord', temperatureRecordSchema);

module.exports = TemperatureRecord;
