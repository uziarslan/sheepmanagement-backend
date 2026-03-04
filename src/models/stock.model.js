const mongoose = require('mongoose');
const { STOCK_CATEGORIES, STOCK_UNITS, ASSET_TYPES } = require('../constants');

const stockSchema = new mongoose.Schema(
  {
    productName: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Name cannot exceed 200 characters']
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: STOCK_CATEGORIES
    },
    assetType: {
      type: String,
      enum: ASSET_TYPES,
      default: null
    },
    unit: {
      type: String,
      required: [true, 'Unit is required'],
      enum: STOCK_UNITS
    },
    purchaseDate: {
      type: Date
    },
    packQuantity: {
      type: Number,
      min: [0, 'Quantity cannot be negative']
    },
    unitSize: {
      type: Number,
      min: [0, 'Unit size cannot be negative']
    },
    totalQuantity: {
      type: Number,
      min: [0, 'Total quantity cannot be negative']
    },
    totalPrice: {
      type: Number,
      min: [0, 'Total price cannot be negative']
    },
    costPerUnit: {
      type: Number,
      min: [0, 'Cost per unit cannot be negative']
    },
    isStockItem: {
      type: Boolean,
      default: true
    },
    openingStockQty: {
      type: Number,
      required: [true, 'Opening stock quantity is required'],
      min: [0, 'Quantity cannot be negative']
    },
    openingRatePerUnit: {
      type: Number,
      required: [true, 'Rate per unit is required'],
      min: [0, 'Rate cannot be negative']
    },
    openingStockAmount: {
      type: Number,
      default: 0,
      min: [0, 'Amount cannot be negative']
    },
    currentQty: {
      type: Number,
      default: 0,
      min: [0, 'Current quantity cannot be negative']
    },
    minStockLevel: {
      type: Number,
      default: 0,
      min: [0, 'Min stock level cannot be negative']
    },
    supplier: {
      type: String,
      trim: true
    },
    expiryDate: {
      type: Date
    },
    batchNumber: {
      type: String,
      trim: true
    },
    storageLocation: {
      type: String,
      trim: true
    },
    notes: {
      type: String,
      maxlength: [500, 'Notes cannot exceed 500 characters']
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
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes
stockSchema.index({ productName: 'text' });
stockSchema.index({ category: 1 });
stockSchema.index({ isActive: 1 });

// Virtual for current stock value
stockSchema.virtual('currentStockValue').get(function () {
  return this.currentQty * this.openingRatePerUnit;
});

// Virtual for stock status
stockSchema.virtual('stockStatus').get(function () {
  if (this.currentQty === 0) return 'Out of Stock';
  if (this.currentQty <= this.minStockLevel) return 'Low Stock';
  return 'In Stock';
});

// Virtual for is expired
stockSchema.virtual('isExpired').get(function () {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
});

// Pre-save middleware to calculate quantities and stock amount
stockSchema.pre('save', function (next) {
  const hasPackQuantity = this.packQuantity !== undefined && this.packQuantity !== null;
  const hasUnitSize = this.unitSize !== undefined && this.unitSize !== null;

  if (hasPackQuantity && hasUnitSize) {
    this.totalQuantity = this.packQuantity * this.unitSize;
  }

  if (this.totalPrice !== undefined && this.totalPrice !== null && this.totalQuantity) {
    this.costPerUnit = this.totalPrice / this.totalQuantity;
  }

  if (this.totalQuantity !== undefined && this.totalQuantity !== null &&
      this.costPerUnit !== undefined && this.costPerUnit !== null) {
    this.openingStockQty = this.totalQuantity;
    this.openingRatePerUnit = this.costPerUnit;
    this.openingStockAmount = this.totalPrice ?? (this.totalQuantity * this.costPerUnit);
  } else if (this.isModified('openingStockQty') || this.isModified('openingRatePerUnit')) {
    this.openingStockAmount = this.openingStockQty * this.openingRatePerUnit;
  }
  
  // Set current qty to opening qty if new
  if (this.isNew && !this.currentQty) {
    this.currentQty = this.openingStockQty;
  }
  
  next();
});

// Method to deduct stock
stockSchema.methods.deductStock = async function (quantity) {
  if (quantity > this.currentQty) {
    throw new Error(`Insufficient stock. Available: ${this.currentQty} ${this.unit}`);
  }
  
  this.currentQty -= quantity;
  return this.save();
};

// Method to add stock
stockSchema.methods.addStock = async function (quantity, rate = null) {
  this.currentQty += quantity;
  
  // Optionally update rate if provided
  if (rate !== null) {
    this.openingRatePerUnit = rate;
  }
  
  return this.save();
};

// Static method to get low stock items
stockSchema.statics.getLowStockItems = async function () {
  return this.find({
    isActive: true,
    $expr: { $lte: ['$currentQty', '$minStockLevel'] }
  });
};

// Static method to get by category
stockSchema.statics.getByCategory = async function (category) {
  return this.find({ category, isActive: true }).sort({ productName: 1 });
};

const Stock = mongoose.model('Stock', stockSchema);

module.exports = Stock;
