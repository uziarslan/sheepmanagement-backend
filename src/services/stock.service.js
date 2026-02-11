const { Stock, Capital } = require('../models');
const { ApiError, getPaginationOptions, getSortOptions, getPaginationMeta, logAction } = require('../utils');

/**
 * Get all stocks with filters
 */
const getAll = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || 'productName');

  // Build filter
  const filter = {};
  if (query.category) filter.category = query.category;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  
  // Low stock filter
  if (query.lowStock) {
    filter.$expr = { $lte: ['$currentQty', '$minStockLevel'] };
  }

  // Search
  if (query.search) {
    filter.$or = [
      { productName: { $regex: query.search, $options: 'i' } },
      { supplier: { $regex: query.search, $options: 'i' } }
    ];
  }

  const [stocks, total] = await Promise.all([
    Stock.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Stock.countDocuments(filter)
  ]);

  // Add computed fields
  const stocksWithComputed = stocks.map(stock => ({
    ...stock,
    currentStockValue: stock.currentQty * stock.openingRatePerUnit,
    stockStatus: stock.currentQty === 0 ? 'Out of Stock' :
      stock.currentQty <= stock.minStockLevel ? 'Low Stock' : 'In Stock'
  }));

  return {
    data: stocksWithComputed,
    meta: getPaginationMeta(total, page, limit)
  };
};

/**
 * Get stock by ID
 */
const getById = async (id) => {
  const stock = await Stock.findById(id);

  if (!stock) {
    throw ApiError.notFound('Stock item not found');
  }

  return stock;
};

/**
 * Create stock item
 */
const create = async (stockData, userId) => {
  const stock = await Stock.create({
    ...stockData,
    createdBy: userId
  });

  // Deduct from capital
  try {
    const capital = await Capital.findOne({ user: userId });
    if (capital && stockData.totalPrice) {
      await capital.addTransaction(
        -stockData.totalPrice, // Negative because it's an investment/expense
        'Stock Purchase',
        `Stock ${stock.productName} purchased - Qty: ${stockData.packQuantity} ${stockData.unit}`,
        stock._id,
        userId
      );
    }
  } catch (error) {
    // Log error but don't fail the request
    console.error('Failed to update capital for stock purchase:', error);
  }

  // Create audit log
  logAction({
    userId,
    action: 'Stock Created',
    entityType: 'Stock',
    entityId: stock._id,
    metadata: {
      productName: stock.productName,
      category: stock.category,
      quantity: stockData.packQuantity,
      unit: stockData.unit,
      totalPrice: stockData.totalPrice
    }
  });

  return stock;
};

/**
 * Update stock
 */
const update = async (id, updateData, userId) => {
  const stock = await Stock.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!stock) {
    throw ApiError.notFound('Stock item not found');
  }

  // Create audit log
  logAction({
    userId,
    action: 'Stock Updated',
    entityType: 'Stock',
    entityId: stock._id,
    metadata: {
      productName: stock.productName,
      category: stock.category,
      changes: updateData
    }
  });

  return stock;
};

/**
 * Delete stock
 */
const remove = async (id, userId) => {
  const stock = await Stock.findByIdAndDelete(id);

  if (!stock) {
    throw ApiError.notFound('Stock item not found');
  }

  // Create audit log
  logAction({
    userId,
    action: 'Stock Deleted',
    entityType: 'Stock',
    entityId: stock._id,
    metadata: {
      productName: stock.productName,
      category: stock.category,
      quantity: stock.currentQty,
      totalPrice: (stock.currentQty * stock.openingRatePerUnit)
    }
  });

  return stock;
};

/**
 * Adjust stock quantity
 */
const adjustStock = async (id, quantity, type, reason, userId) => {
  const stock = await Stock.findById(id);

  if (!stock) {
    throw ApiError.notFound('Stock item not found');
  }

  if (type === 'deduct') {
    if (quantity > stock.currentQty) {
      throw ApiError.badRequest(`Insufficient stock. Available: ${stock.currentQty} ${stock.unit}`);
    }
    stock.currentQty -= quantity;
  } else {
    stock.currentQty += quantity;
  }

  await stock.save();

  // Create audit log
  logAction({
    userId,
    action: 'Stock Quantity Adjusted',
    entityType: 'Stock',
    entityId: stock._id,
    metadata: {
      productName: stock.productName,
      category: stock.category,
      adjustmentType: type,
      quantity: quantity,
      unit: stock.unit,
      reason: reason,
      newQuantity: stock.currentQty
    }
  });

  return stock;
};

/**
 * Get low stock items
 */
const getLowStockItems = async () => {
  return Stock.find({
    isActive: true,
    $expr: { $lte: ['$currentQty', '$minStockLevel'] }
  }).sort({ currentQty: 1 });
};

/**
 * Get stock by category
 */
const getByCategory = async (category) => {
  return Stock.find({ category, isActive: true })
    .sort({ productName: 1 });
};

/**
 * Get stock summary
 */
const getSummary = async () => {
  const summary = await Stock.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: '$category',
        totalItems: { $sum: 1 },
        totalValue: { $sum: { $multiply: ['$currentQty', '$openingRatePerUnit'] } },
        lowStockItems: {
          $sum: {
            $cond: [{ $lte: ['$currentQty', '$minStockLevel'] }, 1, 0]
          }
        },
        outOfStockItems: {
          $sum: {
            $cond: [{ $eq: ['$currentQty', 0] }, 1, 0]
          }
        }
      }
    }
  ]);

  return summary;
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  adjustStock,
  getLowStockItems,
  getByCategory,
  getSummary
};
