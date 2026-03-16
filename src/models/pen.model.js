const mongoose = require('mongoose');
const { PEN_TYPES } = require('../constants');

const penSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Pen name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    type: {
      type: String,
      required: [true, 'Pen type is required'],
      enum: PEN_TYPES
    },
    capacity: {
      type: Number,
      required: [true, 'Capacity is required'],
      min: [1, 'Capacity must be at least 1']
    },
    minWeightAvg: {
      type: Number,
      default: 0,
      min: [0, 'Min weight cannot be negative']
    },
    maxWeightAvg: {
      type: Number,
      default: 100,
      min: [0, 'Max weight cannot be negative']
    },
    description: {
      type: String,
      maxlength: [500, 'Description cannot exceed 500 characters']
    },
    location: {
      type: String,
      trim: true
    },
    isActive: {
      type: Boolean,
      default: true
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
penSchema.index({ name: 1 });
penSchema.index({ type: 1 });
penSchema.index({ isActive: 1 });

// Virtual for animal count (populated by aggregation)
penSchema.virtual('animals', {
  ref: 'Animal',
  localField: '_id',
  foreignField: 'pen',
  match: { status: 'Active' }
});

// Virtual to calculate occupancy percentage
penSchema.virtual('occupancyPercentage').get(function () {
  if (!this._animalCount) return 0;
  return Math.round((this._animalCount / this.capacity) * 100);
});

// Method to get animal count
penSchema.methods.getAnimalCount = async function () {
  const Animal = mongoose.model('Animal');
  return Animal.countDocuments({ pen: this._id, status: 'Active' });
};

// Static method to get all pens with animal counts
penSchema.statics.getAllWithCounts = async function () {
  return this.aggregate([
    {
      $lookup: {
        from: 'animals',
        let: { penId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$pen', '$$penId'] },
                  { $eq: ['$status', 'Active'] }
                ]
              }
            }
          }
        ],
        as: 'activeAnimals'
      }
    },
    {
      $addFields: {
        animalCount: { $size: '$activeAnimals' }
      }
    },
    {
      $project: {
        activeAnimals: 0
      }
    },
    {
      $sort: { createdAt: -1 }
    }
  ]);
};

// Pre-delete middleware to check for animals
penSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
  const Animal = mongoose.model('Animal');
  const animalCount = await Animal.countDocuments({ pen: this._id, status: 'Active' });
  
  if (animalCount > 0) {
    const error = new Error('Cannot delete pen with active animals. Please move animals first.');
    error.statusCode = 400;
    return next(error);
  }
  next();
});

const Pen = mongoose.model('Pen', penSchema);

module.exports = Pen;
