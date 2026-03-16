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

    // Distribute vaccination cost to animals
    if (this.totalCost > 0) {
      const Animal = mongoose.model('Animal');

      if ((this.scope === 'Individual' || this.scope === 'Individual Animal') && this.animal) {
        // Individual animal - full cost to one animal
        await Animal.findByIdAndUpdate(this.animal, {
          $inc: { totalVaccinationCost: this.totalCost }
        });
      } else if ((this.scope === 'Pen' || this.scope === 'Shed') && this.pen) {
        // Pen/Shed scope - divide among active animals in pen
        const activeAnimals = await Animal.find({ pen: this.pen, status: 'Active' });
        if (activeAnimals.length > 0) {
          const perAnimalBase = Math.floor(this.totalCost * 100 / activeAnimals.length) / 100;
          const remainder = Number((this.totalCost - perAnimalBase * activeAnimals.length).toFixed(2));
          // Apply base to all
          await Animal.updateMany(
            { pen: this.pen, status: 'Active' },
            { $inc: { totalVaccinationCost: perAnimalBase } }
          );
          // Apply remainder to first animal
          if (remainder > 0 && activeAnimals.length > 0) {
            await Animal.findByIdAndUpdate(activeAnimals[0]._id, {
              $inc: { totalVaccinationCost: remainder }
            });
          }
        }
      } else if (this.scope === 'Multiple' && this.animals && this.animals.length > 0) {
        // Multiple animals - divide among selected animals
        const perAnimalBase = Math.floor(this.totalCost * 100 / this.animals.length) / 100;
        const remainder = Number((this.totalCost - perAnimalBase * this.animals.length).toFixed(2));
        // Apply base to all
        await Animal.updateMany(
          { _id: { $in: this.animals }, status: 'Active' },
          { $inc: { totalVaccinationCost: perAnimalBase } }
        );
        // Apply remainder to first animal
        if (remainder > 0 && this.animals.length > 0) {
          await Animal.findByIdAndUpdate(this.animals[0], {
            $inc: { totalVaccinationCost: remainder }
          });
        }
      } else if (this.scope === 'All Animals') {
        // All animals scope - divide among all active animals
        const activeAnimalCount = await Animal.countDocuments({ status: 'Active' });
        if (activeAnimalCount > 0) {
          const perAnimalBase = Math.floor(this.totalCost * 100 / activeAnimalCount) / 100;
          const remainder = Number((this.totalCost - perAnimalBase * activeAnimalCount).toFixed(2));
          // Apply base to all
          await Animal.updateMany(
            { status: 'Active' },
            { $inc: { totalVaccinationCost: perAnimalBase } }
          );
          // Apply remainder to first animal
          if (remainder > 0) {
            const firstAnimal = await Animal.findOne({ status: 'Active' });
            if (firstAnimal) {
              await firstAnimal.updateOne({ $inc: { totalVaccinationCost: remainder } });
            }
          }
        }
      }
    }
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
