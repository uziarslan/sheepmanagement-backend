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
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes
feedApplicationSchema.index({ recipe: 1 });
feedApplicationSchema.index({ pen: 1 });
feedApplicationSchema.index({ date: -1 });

// Pre-save middleware to deduct stock and update recipe
feedApplicationSchema.pre('save', async function (next) {
  if (this.isNew) {
    const FeedRecipe = mongoose.model('FeedRecipe');
    const Animal = mongoose.model('Animal');
    
    // Update recipe applied count
    if (this.recipe) {
      const recipe = await FeedRecipe.findById(this.recipe);
      if (recipe) {
        await recipe.incrementAppliedCount();
      }
    }
    
    // Distribute cost to animals in pen
    if (this.pen && this.animalCount > 0) {
      const costPerAnimal = this.totalCost / this.animalCount;
      
      await Animal.updateMany(
        { pen: this.pen, status: 'Active' },
        { $inc: { totalFeedCost: costPerAnimal } }
      );
    }
  }
  next();
});

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
