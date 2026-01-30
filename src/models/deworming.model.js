const mongoose = require('mongoose');
const { DEWORMING_SCOPES, DEWORMING_TYPES } = require('../constants');

const dewormingMedicineSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stock',
    required: true
  },
  medicineName: String,
  quantity: {
    type: Number,
    required: true,
    min: [0.1, 'Quantity must be greater than 0']
  },
  unit: String,
  rate: Number,
  total: Number
}, { _id: false });

const dewormingSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: [true, 'Deworming date is required'],
      default: Date.now
    },
    scope: {
      type: String,
      required: [true, 'Scope is required'],
      enum: DEWORMING_SCOPES
    },
    pen: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Pen'
    },
    penName: String,
    animal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Animal'
    },
    animalTagId: String,
    animalCount: {
      type: Number,
      default: 0
    },
    dewormingType: {
      type: String,
      required: [true, 'Deworming type is required'],
      enum: DEWORMING_TYPES
    },
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    technicianName: String,
    medicines: [dewormingMedicineSchema],
    totalCost: {
      type: Number,
      default: 0,
      min: 0
    },
    nextDueDate: Date,
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
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes
dewormingSchema.index({ date: -1 });
dewormingSchema.index({ scope: 1 });
dewormingSchema.index({ pen: 1 });
dewormingSchema.index({ animal: 1 });
dewormingSchema.index({ dewormingType: 1 });

// Pre-save middleware to deduct stock
dewormingSchema.pre('save', async function (next) {
  if (this.isNew && this.medicines && this.medicines.length > 0) {
    const Stock = mongoose.model('Stock');
    
    for (const med of this.medicines) {
      const stock = await Stock.findById(med.medicine);
      if (stock) {
        if (stock.currentQty < med.quantity) {
          return next(new Error(`Insufficient stock for ${stock.productName}`));
        }
        stock.currentQty -= med.quantity;
        await stock.save();
      }
    }
    
    // Calculate total cost
    this.totalCost = this.medicines.reduce((sum, med) => sum + (med.total || 0), 0);
  }
  next();
});

// Static method to get dewormings due soon
dewormingSchema.statics.getDueSoon = async function (daysAhead = 7) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysAhead);
  
  return this.find({
    nextDueDate: { $lte: futureDate, $gte: new Date() }
  })
    .populate('pen', 'name')
    .populate('animal', 'tagId name')
    .sort({ nextDueDate: 1 });
};

const Deworming = mongoose.model('Deworming', dewormingSchema);

module.exports = Deworming;
