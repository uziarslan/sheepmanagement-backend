const { Stock, Capital } = require('../models');
const logger = require('../utils/logger');
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
  const transport = Number(stockData.transportation) || 0;
  const loading = Number(stockData.loadingUnloading) || 0;
  const totalCost = (Number(stockData.totalPrice) || 0) + transport + loading;

  const dataForStock = { ...stockData };
  delete dataForStock.transportation;
  delete dataForStock.loadingUnloading;
  dataForStock.totalPrice = totalCost;

  const stock = await Stock.create({
    ...dataForStock,
    createdBy: userId
  });

  // Deduct from capital: totalPrice + transportation + loadingUnloading (Infrastructure for Assets, Stock Purchase for others)
  try {
    const capital = await Capital.findOne({ user: userId });
    if (capital && totalCost > 0) {
      const isAsset = stockData.category === 'Assets';
      const txType = isAsset ? 'Infrastructure' : 'Stock Purchase';
      let desc = isAsset
        ? `Asset (${stockData.assetType || 'Others'}): ${stock.productName}`
        : `Stock ${stock.productName} purchased - Qty: ${stockData.packQuantity} ${stockData.unit}`;
      if (transport > 0 || loading > 0) {
        const parts = [];
        if (transport > 0) parts.push(`Transport: Rs.${transport}`);
        if (loading > 0) parts.push(`Loading: Rs.${loading}`);
        desc += ` (${parts.join(', ')})`;
      }
      await capital.addTransaction(
        -totalCost, // includes base price + transport + loading
        txType,
        desc,
        stock._id,
        userId
      );
    }
  } catch (error) {
    // Log error but don't fail the request
    logger.error('Failed to update capital for stock purchase:', error);
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
      totalPrice: totalCost
    }
  });

  return stock;
};

/**
 * Update stock
 */
const update = async (id, updateData, userId) => {
  // Load document to trigger pre-save hook
  const stock = await Stock.findById(id);

  if (!stock) {
    throw ApiError.notFound('Stock item not found');
  }

  // Assign fields and save (triggers pre-save hooks)
  Object.assign(stock, updateData);
  await stock.save();

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
  // Debug log: record adjustment intent and current qty
  try {
    logger.info(`[stock.service] adjustStock called by user=${userId} id=${id} type=${type} qty=${quantity} reason=${reason} currentQty=${stock.currentQty}`);
  } catch (e) {
    logger.error('Failed to log adjustStock call', e);
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
