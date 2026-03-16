const mongoose = require('mongoose');

const ingredientSchema = new mongoose.Schema({
  stock: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stock',
    required: true
  },
  name: String,
  unit: String,
  ratePerUnit: Number,
  currentStock: Number,
  quantity: {
    type: Number,
    required: true,
    min: [0.1, 'Quantity must be greater than 0']
  },
  total: Number
}, { _id: false });

const feedRecipeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Recipe name is required'],
      trim: true,
      maxlength: [200, 'Name cannot exceed 200 characters']
    },
    description: {
      type: String,
      maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    pen: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Pen',
      required: [true, 'Pen is required']
    },
    penName: String,
    ingredients: [ingredientSchema],
    totalQuantity: {
      type: Number,
      default: 0,
      min: 0
    },
    totalCost: {
      type: Number,
      default: 0,
      min: 0
    },
    appliedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    lastAppliedDate: Date,
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
feedRecipeSchema.index({ name: 1 });
feedRecipeSchema.index({ pen: 1 });
feedRecipeSchema.index({ isActive: 1 });

// Pre-save middleware to calculate totals
feedRecipeSchema.pre('save', function (next) {
  // Reset totals to 0 before recalculating
  this.totalQuantity = 0;
  this.totalCost = 0;

  if (this.ingredients && this.ingredients.length > 0) {
    this.totalQuantity = this.ingredients.reduce((sum, ing) => sum + ing.quantity, 0);
    this.totalCost = this.ingredients.reduce((sum, ing) => sum + (ing.total || 0), 0);
  }
  next();
});

// Virtual for cost per animal (requires pen animal count)
feedRecipeSchema.virtual('applications', {
  ref: 'FeedApplication',
  localField: '_id',
  foreignField: 'recipe'
});

// Method to increment applied count
feedRecipeSchema.methods.incrementAppliedCount = async function () {
  this.appliedCount += 1;
  this.lastAppliedDate = new Date();
  return this.save();
};

const FeedRecipe = mongoose.model('FeedRecipe', feedRecipeSchema);

module.exports = FeedRecipe;
