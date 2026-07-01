const {
  Stock,
  Capital,
  FeedRecipe,
  FeedApplication,
  VaccineRecipe,
  VaccineApplication,
  Vaccination,
  Treatment,
  Deworming
} = require('../models');
const logger = require('../utils/logger');
const {
  ApiError,
  getPaginationOptions,
  getSortOptions,
  getPaginationMeta,
  logAction,
  withTransaction,
  diffFields
} = require('../utils');

/**
 * Check whether a stock document is referenced by recipes or historical
 * application/treatment records. Returns null when safe to delete, otherwise
 * a structured summary of where it's used.
 */
const findStockReferences = async (stockId) => {
  const [
    feedRecipeCount,
    feedApplicationCount,
    vaccineRecipeCount,
    vaccineApplicationCount,
    vaccinationCount,
    treatmentCount,
    dewormingCount
  ] = await Promise.all([
    FeedRecipe.countDocuments({ 'ingredients.stock': stockId }),
    FeedApplication.countDocuments({ 'ingredients.stock': stockId }),
    VaccineRecipe.countDocuments({ 'medicines.medicine': stockId }),
    VaccineApplication.countDocuments({ 'medicineUsed.medicine': stockId }),
    Vaccination.countDocuments({ 'medicines.medicine': stockId }),
    Treatment.countDocuments({ 'medicines.medicine': stockId }),
    Deworming.countDocuments({ 'medicines.medicine': stockId })
  ]);

  const total =
    feedRecipeCount +
    feedApplicationCount +
    vaccineRecipeCount +
    vaccineApplicationCount +
    vaccinationCount +
    treatmentCount +
    dewormingCount;

  if (total === 0) return null;

  return {
    feedRecipes: feedRecipeCount,
    feedApplications: feedApplicationCount,
    vaccineRecipes: vaccineRecipeCount,
    vaccineApplications: vaccineApplicationCount,
    vaccinations: vaccinationCount,
    treatments: treatmentCount,
    dewormings: dewormingCount
  };
};

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

  // Search. Escape regex metacharacters so user input can't inject a
  // catastrophic-backtracking pattern (ReDoS). Preserves contains/i behavior.
  if (query.search) {
    const escaped = String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { productName: { $regex: escaped, $options: 'i' } },
      { supplier: { $regex: escaped, $options: 'i' } }
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

  const stock = await withTransaction(async (session) => {
    const [created] = await Stock.create(
      [{ ...dataForStock, createdBy: userId }],
      session ? { session } : {}
    );

    if (totalCost > 0) {
      const isAsset = stockData.category === 'Assets';
      const txType = isAsset ? 'Infrastructure' : 'Stock Purchase';
      let desc = isAsset
        ? `Asset (${stockData.assetType || 'Others'}): ${created.productName}`
        : `Stock ${created.productName} purchased - Qty: ${stockData.packQuantity} ${stockData.unit}`;
      if (transport > 0 || loading > 0) {
        const parts = [];
        if (transport > 0) parts.push(`Transport: Rs.${transport}`);
        if (loading > 0) parts.push(`Loading: Rs.${loading}`);
        desc += ` (${parts.join(', ')})`;
      }

      const result = await Capital.atomicAddTransaction({
        amount: -totalCost,
        type: txType,
        description: desc,
        reference: String(created._id),
        createdBy: userId
      }, session);
      if (!result) {
        throw ApiError.badRequest(
          'Capital not initialized. Initialize capital before recording stock purchases.'
        );
      }
    }

    return created;
  });

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
 *
 * If totalPrice / packQuantity / unitSize change, the corresponding capital
 * transaction is kept in sync so the deduction in the Capital page always
 * matches the stock's current cost.
 */
const update = async (id, updateData, userId) => {
  const stock = await Stock.findById(id);

  if (!stock) {
    throw ApiError.notFound('Stock item not found');
  }

  // Capture before-state for AL3 audit diff (lean snapshot — frozen).
  const beforeDoc = stock.toObject();

  const oldOpeningAmount = Number(stock.openingStockAmount) || 0;
  const oldOpeningQty = Number(stock.openingStockQty) || 0;

  // Apply incoming changes
  Object.assign(stock, updateData);

  // The pre-save hook only recalculates totalQuantity/costPerUnit/openingStockQty
  // for new documents. For edits, recalculate explicitly so the cost lines
  // that drive capital stay accurate.
  if (
    updateData.totalPrice !== undefined ||
    updateData.packQuantity !== undefined ||
    updateData.unitSize !== undefined
  ) {
    const packQty = Number(stock.packQuantity) || 0;
    const unitSize = Number(stock.unitSize) || 1;
    const newTotalQty = packQty * unitSize;
    const newTotalPrice = Number(stock.totalPrice) || 0;
    const newRate = newTotalQty > 0 ? newTotalPrice / newTotalQty : 0;

    stock.totalQuantity = newTotalQty;
    stock.costPerUnit = newRate;
    stock.openingRatePerUnit = newRate;
    stock.openingStockAmount = newTotalPrice;
    stock.openingStockQty = newTotalQty;

    // Preserve consumption: keep consumed quantity intact, scale remaining to new opening qty.
    const consumed = Math.max(0, oldOpeningQty - (Number(stock.currentQty) || 0));
    stock.currentQty = Math.max(0, newTotalQty - consumed);
  }

  await stock.save();

  // Sync capital: update the original purchase transaction amount + balances.
  // Sprint 5: switched from findOne+mutate+save() to atomic array-positional
  // $set + $inc so concurrent stock edits can't lose each other's writes.
  try {
    const newAmount = Number(stock.openingStockAmount) || 0;
    const delta = newAmount - oldOpeningAmount; // +ve = more deducted, -ve = refund
    if (delta !== 0) {
      const isAsset = stock.category === 'Assets';
      const txType = isAsset ? 'Infrastructure' : 'Stock Purchase';

      const inc = { availableAmount: -delta };
      if (['Stock Purchase', 'Infrastructure'].includes(txType)) {
        inc.investedAmount = delta;
      }

      await Capital.findOneAndUpdate(
        {
          'history.reference': String(stock._id),
          'history.type': txType
        },
        {
          $set: {
            'history.$.amount': -newAmount,
            'history.$.description':
              `Stock ${stock.productName} - cost updated to Rs.${newAmount.toLocaleString()} (was Rs.${oldOpeningAmount.toLocaleString()})`,
            lastUpdated: new Date()
          },
          $inc: inc
        }
      );
    }
  } catch (err) {
    logger.error('Failed to sync capital after stock update:', err);
  }

  // AL3: log the actual before/after diff over the fields the caller touched,
  // plus the derived recompute fields (rate/qty) which a price edit changes.
  const trackedKeys = [
    ...Object.keys(updateData),
    'totalQuantity', 'costPerUnit', 'openingRatePerUnit',
    'openingStockAmount', 'openingStockQty', 'currentQty'
  ];
  const diff = diffFields(beforeDoc, stock.toObject(), trackedKeys);

  logAction({
    userId,
    action: 'Stock Updated',
    entityType: 'Stock',
    entityId: stock._id,
    metadata: {
      productName: stock.productName,
      category: stock.category,
      diff
    }
  });

  return stock;
};

/**
 * Delete stock and revert the capital impact.
 *
 * Refund rule (handles the consumed-stock edge case):
 *   - If the stock has not been used at all, the original purchase transaction is
 *     removed from capital history entirely and the full purchase cost is refunded.
 *   - If part of the stock has been consumed, only the unused portion is refunded;
 *     the original transaction is rewritten to reflect the cost of the consumed
 *     portion only (a real expense that cannot be reversed).
 *
 *   refund         = currentQty * openingRatePerUnit
 *   consumedCost   = (openingStockQty - currentQty) * openingRatePerUnit
 *
 * Because transportation/loading were rolled into totalPrice on create,
 * openingRatePerUnit already represents the true per-unit cost including those.
 */
const remove = async (id, userId) => {
  const stock = await Stock.findById(id);

  if (!stock) {
    throw ApiError.notFound('Stock item not found');
  }

  // Block deletion if the stock is still referenced anywhere. Mark inactive
  // (PUT with isActive=false) if you want to retire it without losing history.
  const refs = await findStockReferences(id);
  if (refs) {
    const where = Object.entries(refs)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}: ${n}`)
      .join(', ');
    throw ApiError.badRequest(
      `Cannot delete "${stock.productName}" — it is referenced by ${where}. ` +
      `Remove or replace those references first, or set isActive=false to retire it.`
    );
  }

  const openingQty = Number(stock.openingStockQty) || 0;
  const currentQty = Number(stock.currentQty) || 0;
  const ratePerUnit = Number(stock.openingRatePerUnit) || 0;
  const consumedQty = Math.max(0, openingQty - currentQty);
  const consumedCost = consumedQty * ratePerUnit;
  const refund = currentQty * ratePerUnit;

  // Atomic: capital adjust + stock delete commit together via atomic operators
  // (Sprint 4). The previous version did a findOne → mutate → save() which
  // races under concurrency on standalone Mongo. We now use $pull / array-
  // positional $set + $inc so the singleton update is a single write.
  await withTransaction(async (session) => {
    const sessOpt = session ? { session } : {};
    const isAsset = stock.category === 'Assets';
    const txType = isAsset ? 'Infrastructure' : 'Stock Purchase';

    // Find the original purchase transaction so we know its current amount.
    // The race window between this read and the update below is closed by
    // a `history.$._id` positional filter on the update — if the tx was
    // already pulled/mutated by another caller, our update no-ops cleanly.
    const cap = await Capital.findOne(
      { 'history.reference': String(stock._id), 'history.type': txType },
      { 'history.$': 1 }
    ).session(session || null).lean();
    const tx = cap?.history?.[0];

    if (tx) {
      const originalAbs = Math.abs(tx.amount);
      const isInvestmentType = ['Stock Purchase', 'Infrastructure'].includes(tx.type);

      if (consumedQty <= 0) {
        // Nothing consumed — pull the tx and refund the full deduction.
        const inc = { availableAmount: originalAbs };
        if (isInvestmentType) inc.investedAmount = -originalAbs;
        await Capital.findOneAndUpdate(
          {},
          {
            $pull: { history: { _id: tx._id } },
            $inc: inc,
            $set: { lastUpdated: new Date() }
          },
          sessOpt
        );
      } else {
        // Partial consumption — rewrite the tx in place; refund the unused.
        const refundClamped = Math.min(originalAbs, refund);
        const inc = { availableAmount: refundClamped };
        if (isInvestmentType) inc.investedAmount = -refundClamped;
        await Capital.findOneAndUpdate(
          { 'history._id': tx._id },
          {
            $set: {
              'history.$.amount': -consumedCost,
              'history.$.description':
                `Stock ${stock.productName} deleted - ${consumedQty} ${stock.unit} already consumed kept as expense, ` +
                `${currentQty} ${stock.unit} unused refunded (Rs.${refundClamped.toLocaleString()})`,
              lastUpdated: new Date()
            },
            $inc: inc
          },
          sessOpt
        );
      }
    }

    await Stock.findByIdAndDelete(id, sessOpt);
  });

  logAction({
    userId,
    action: 'Stock Deleted',
    entityType: 'Stock',
    entityId: stock._id,
    metadata: {
      productName: stock.productName,
      category: stock.category,
      openingQty,
      currentQty,
      consumedQty,
      refundAmount: refund,
      consumedCost
    }
  });

  return stock;
};

/**
 * Adjust stock quantity.
 *
 * 'reason' is required by validation. Each adjustment posts a 'Stock
 * Adjustment' line to capital.history for ledger visibility:
 *   - deduct (spoilage/loss/theft): recognized as a loss (capital.loss += value).
 *   - add    (found inventory / correction): recognized as a gain (capital.profit += value).
 * availableAmount and totalCapital are NOT touched — the cash flow happened at
 * purchase time. We're only recognizing the write-down / write-up here.
 */
const adjustStock = async (id, quantity, type, reason, userId) => {
  // Pre-fetch product info for messages + ledger calculation
  const meta = await Stock.findById(id, 'productName unit category openingRatePerUnit currentQty').lean();
  if (!meta) {
    throw ApiError.notFound('Stock item not found');
  }

  logger.info(
    `[stock.service] adjustStock user=${userId} id=${id} type=${type} ` +
    `qty=${quantity} reason=${reason} currentQty=${meta.currentQty}`
  );

  const ratePerUnit = Number(meta.openingRatePerUnit) || 0;
  const adjustmentValue = quantity * ratePerUnit;

  const stock = await withTransaction(async (session) => {
    let updatedStock;
    if (type === 'deduct') {
      // Atomic deduct — only succeeds if currentQty >= quantity
      updatedStock = await Stock.findOneAndUpdate(
        { _id: id, currentQty: { $gte: quantity } },
        { $inc: { currentQty: -quantity } },
        { new: true, ...(session ? { session } : {}) }
      );
      if (!updatedStock) {
        throw ApiError.badRequest(
          `Insufficient stock. Available: ${meta.currentQty} ${meta.unit}`
        );
      }
    } else {
      updatedStock = await Stock.findByIdAndUpdate(
        id,
        { $inc: { currentQty: quantity } },
        { new: true, ...(session ? { session } : {}) }
      );
    }

    // Post capital ledger entry recognizing the write-down (deduct) or
    // write-up (add). Atomic — uses findOneAndUpdate, not save().
    if (adjustmentValue > 0) {
      const sign = type === 'deduct' ? -1 : 1;
      const desc =
        type === 'deduct'
          ? `Stock write-down: ${updatedStock.productName} -${quantity} ${updatedStock.unit} (${reason})`
          : `Stock write-up: ${updatedStock.productName} +${quantity} ${updatedStock.unit} (${reason})`;

      await Capital.findOneAndUpdate(
        {},
        {
          $push: {
            history: {
              amount: sign * adjustmentValue,
              type: 'Stock Adjustment',
              date: new Date(),
              description: desc,
              reference: String(updatedStock._id),
              createdBy: userId || null
            }
          },
          $inc: type === 'deduct'
            ? { loss: adjustmentValue }
            : { profit: adjustmentValue },
          $set: { lastUpdated: new Date() }
        },
        session ? { session } : {}
      );
    }

    return updatedStock;
  });

  logAction({
    userId,
    action: 'Stock Quantity Adjusted',
    entityType: 'Stock',
    entityId: stock._id,
    metadata: {
      productName: stock.productName,
      category: stock.category,
      adjustmentType: type,
      quantity,
      unit: stock.unit,
      ratePerUnit,
      ledgerValue: adjustmentValue,
      reason,
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
