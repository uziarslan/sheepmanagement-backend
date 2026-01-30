const mongoose = require('mongoose');
const { VACCINATION_SCOPES } = require('../constants');

const medicineUsedSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stock',
    required: true
  },
  medicineName: String,
  packSize: Number,
  currentQty: Number,
  quantity: {
    type: Number,
    required: true,
    min: [0.1, 'Quantity must be greater than 0']
  },
  unit: String,
  rate: Number,
  total: Number
}, { _id: false });

const vaccinationSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: [true, 'Vaccination date is required'],
      default: Date.now
    },
    scope: {
      type: String,
      required: [true, 'Scope is required'],
      enum: VACCINATION_SCOPES
    },
    pen: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Pen'
    },
    animal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Animal'
    },
    animals: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Animal'
    }],
    animalCount: {
      type: Number,
      default: 0
    },
    medicines: [medicineUsedSchema],
    totalCost: {
      type: Number,
      default: 0,
      min: 0
    },
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    technicianName: String,
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
vaccinationSchema.index({ date: -1 });
vaccinationSchema.index({ scope: 1 });
vaccinationSchema.index({ pen: 1 });
vaccinationSchema.index({ animal: 1 });

// Pre-save middleware to deduct stock
vaccinationSchema.pre('save', async function (next) {
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

// Static method to get vaccinations by date range
vaccinationSchema.statics.getByDateRange = async function (startDate, endDate) {
  return this.find({
    date: { $gte: new Date(startDate), $lte: new Date(endDate) }
  })
    .populate('pen', 'name')
    .populate('animal', 'tagId name')
    .populate('technician', 'name')
    .sort({ date: -1 });
};

const Vaccination = mongoose.model('Vaccination', vaccinationSchema);

module.exports = Vaccination;
