const mongoose = require('mongoose');
const {
  ANIMAL_TYPES,
  BREED_TYPES,
  ANIMAL_SUBCATEGORIES,
  SEX_OPTIONS,
  COUNTRIES,
  ANIMAL_STATUSES
} = require('../constants');

const animalSchema = new mongoose.Schema(
  {
    tagId: {
      type: String,
      required: [true, 'Tag ID is required'],
      unique: true,
      trim: true,
      uppercase: true
    },
    electronicId: {
      type: String,
      trim: true,
      sparse: true // Allows null/undefined to not violate unique constraint
    },
    name: {
      type: String,
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    animalType: {
      type: String,
      required: [true, 'Animal type is required'],
      enum: ANIMAL_TYPES
    },
    breedType: {
      type: String,
      required: [true, 'Breed type is required'],
      enum: BREED_TYPES
    },
    subcategory: {
      type: String,
      required: [true, 'Subcategory is required'],
      enum: ANIMAL_SUBCATEGORIES
    },
    sex: {
      type: String,
      required: [true, 'Sex is required'],
      enum: SEX_OPTIONS
    },
    purchasedFrom: {
      type: String,
      enum: COUNTRIES,
      default: 'Pakistan'
    },
    arrivalDate: {
      type: Date,
      required: [true, 'Arrival date is required']
    },
    birthDate: {
      type: Date
    },
    purchasePrice: {
      type: Number,
      required: [true, 'Purchase price is required'],
      min: [0, 'Price cannot be negative']
    },
    weight: {
      type: Number,
      required: [true, 'Weight is required'],
      min: [0, 'Weight cannot be negative']
    },
    weightDate: {
      type: Date,
      default: Date.now
    },
    pen: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Pen'
    },
    status: {
      type: String,
      enum: ANIMAL_STATUSES,
      default: 'Active'
    },
    pedigreeInfo: {
      type: Boolean,
      default: false
    },
    picture: {
      type: String,
      default: null
    },
    // Parent information
    sire: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Animal'
    },
    dam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Animal'
    },
    // Additional metadata
    notes: {
      type: String,
      maxlength: [1000, 'Notes cannot exceed 1000 characters']
    },
    soldDate: {
      type: Date
    },
    soldPrice: {
      type: Number,
      min: [0, 'Sold price cannot be negative']
    },
    deathDate: {
      type: Date
    },
    deathReason: {
      type: String
    },
    // Cost tracking
    totalFeedCost: {
      type: Number,
      default: 0,
      min: 0
    },
    totalHealthCost: {
      type: Number,
      default: 0,
      min: 0
    },
    // Created by user
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
animalSchema.index({ tagId: 1 });
animalSchema.index({ pen: 1 });
animalSchema.index({ status: 1 });
animalSchema.index({ animalType: 1 });
animalSchema.index({ createdAt: -1 });

// Virtual for age in months
animalSchema.virtual('ageInMonths').get(function () {
  if (!this.birthDate) return null;
  const now = new Date();
  const months = (now.getFullYear() - this.birthDate.getFullYear()) * 12 +
    (now.getMonth() - this.birthDate.getMonth());
  return months;
});

// Virtual for price per kg
animalSchema.virtual('pricePerKg').get(function () {
  if (!this.weight || this.weight === 0) return 0;
  return Math.round(this.purchasePrice / this.weight);
});

// Virtual for total cost
animalSchema.virtual('totalCost').get(function () {
  return this.purchasePrice + this.totalFeedCost + this.totalHealthCost;
});

// Virtual for profit/loss (if sold)
animalSchema.virtual('profitLoss').get(function () {
  if (!this.soldPrice) return null;
  return this.soldPrice - this.totalCost;
});

// Static method to get active animals count by pen
animalSchema.statics.getCountByPen = async function (penId) {
  return this.countDocuments({ pen: penId, status: 'Active' });
};

// Pre-save middleware to generate tagId if not provided
animalSchema.pre('save', async function (next) {
  if (!this.tagId) {
    const prefix = this.animalType === 'Sheep' ? 'SHP' : 'GOT';
    const count = await this.constructor.countDocuments();
    this.tagId = `${prefix}-${String(count + 1).padStart(3, '0')}`;
  }
  next();
});

const Animal = mongoose.model('Animal', animalSchema);

module.exports = Animal;
