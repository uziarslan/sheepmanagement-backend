const mongoose = require('mongoose');

const appliedIngredientSchema = new mongoose.Schema({
  stock: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stock'
  },
  name: String,
  unit: String,
  quantity: Number,
  rate: Number,
  total: Number
}, { _id: false });

const feedApplicationSchema = new mongoose.Schema(
  {
    recipe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FeedRecipe',
      required: [true, 'Recipe is required']
    },
    recipeName: String,
    pen: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Pen',
      required: [true, 'Pen is required']
    },
    penName: String,
    date: {
      type: Date,
      required: [true, 'Application date is required'],
      default: Date.now
    },
    animalCount: {
      type: Number,
      default: 0,
      min: 0
    },
    ingredients: [appliedIngredientSchema],
    totalCost: {
      type: Number,
      default: 0,
      min: 0
    },
    costPerAnimal: {
      type: Number,
      default: 0,
      min: 0
    },
    notes: {
      type: String,
      maxlength: [1000, 'Notes cannot exceed 1000 characters']
    },
    appliedBy: {
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
feedApplicationSchema.index({ recipe: 1 });
feedApplicationSchema.index({ pen: 1 });
feedApplicationSchema.index({ date: -1 });

// NOTE: Side effects (recipe counter increment, animal cost distribution) were
// previously done in a pre-save hook. They've been moved to feed.service.js so
// they can share the session of the surrounding transaction (Sprint 2).
// Do NOT re-add side effects here without threading session through.

// Static method to get applications by date range
feedApplicationSchema.statics.getByDateRange = async function (startDate, endDate) {
  return this.find({
    date: { $gte: new Date(startDate), $lte: new Date(endDate) }
  })
    .populate('recipe', 'name')
    .populate('pen', 'name')
    .populate('appliedBy', 'name')
    .sort({ date: -1 });
};

// Static method to get total feed cost for pen
feedApplicationSchema.statics.getTotalCostByPen = async function (penId, startDate, endDate) {
  const result = await this.aggregate([
    {
      $match: {
        pen: new mongoose.Types.ObjectId(penId),
        date: { $gte: new Date(startDate), $lte: new Date(endDate) }
      }
    },
    {
      $group: {
        _id: null,
        totalCost: { $sum: '$totalCost' },
        applicationCount: { $sum: 1 }
      }
    }
  ]);
  
  return result[0] || { totalCost: 0, applicationCount: 0 };
};

const FeedApplication = mongoose.model('FeedApplication', feedApplicationSchema);

module.exports = FeedApplication;
