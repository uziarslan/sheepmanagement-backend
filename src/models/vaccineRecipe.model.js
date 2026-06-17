const mongoose = require('mongoose');

const medicineIngredientSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stock',
    required: true
  },
  name: String,
  unit: String,
  quantity: {
    type: Number,
    required: true,
    min: [0.001, 'Quantity must be greater than 0']
  },
  ratePerUnit: Number,
  currentStock: Number,
  total: Number
}, { _id: false });

const vaccineRecipeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Vaccine name is required'],
      trim: true
    },
    disease: {
      type: String,
      required: [true, 'Disease is required'],
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    medicines: {
      type: [medicineIngredientSchema],
      required: true,
      validate: {
        validator: function(v) {
          return v && v.length > 0;
        },
        message: 'At least one medicine is required'
      }
    },
    totalQuantity: {
      type: Number,
      default: 0
    },
    totalCost: {
      type: Number,
      default: 0
    },
    dosageInstructions: {
      type: String,
      trim: true
    },
    nextDoseDays: {
      type: Number,
      min: 0
    },
    isActive: {
      type: Boolean,
      default: true
    },
    appliedCount: {
      type: Number,
      default: 0
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
vaccineRecipeSchema.index({ name: 1 });
vaccineRecipeSchema.index({ disease: 1 });
vaccineRecipeSchema.index({ isActive: 1 });
vaccineRecipeSchema.index({ createdAt: -1 });

const VaccineRecipe = mongoose.model('VaccineRecipe', vaccineRecipeSchema);

module.exports = VaccineRecipe;
