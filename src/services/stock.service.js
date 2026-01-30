const { Stock } = require('../models');
const { ApiError, getPaginationOptions, getSortOptions, getPaginationMeta } = require('../utils');

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

  return stock;
};

/**
 * Update stock
 */
const update = async (id, updateData) => {
  const stock = await Stock.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!stock) {
    throw ApiError.notFound('Stock item not found');
  }

  return stock;
};

/**
 * Delete stock
 */
const remove = async (id) => {
  const stock = await Stock.findByIdAndDelete(id);

  if (!stock) {
    throw ApiError.notFound('Stock item not found');
  }

  return stock;
};

/**
 * Adjust stock quantity
 */
const adjustStock = async (id, quantity, type, reason) => {
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
