const { Animal, Pen, Capital } = require('../models');
const logger = require('../utils/logger');
const { ApiError, getPaginationOptions, getSortOptions, getPaginationMeta, logAction } = require('../utils');

/**
 * Get all animals with filters and pagination
 */
const getAll = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-createdAt');

  // Build filter
  const filter = {};
  
  if (query.status) filter.status = query.status;
  if (query.animalType) filter.animalType = query.animalType;
  if (query.breedType) filter.breedType = query.breedType;
  if (query.subcategory) filter.subcategory = query.subcategory;
  if (query.sex) filter.sex = query.sex;
  if (query.pen) filter.pen = query.pen;

  // Search
  if (query.search) {
    filter.$or = [
      { tagId: { $regex: query.search, $options: 'i' } },
      { name: { $regex: query.search, $options: 'i' } },
      { electronicId: { $regex: query.search, $options: 'i' } }
    ];
  }

  const [animals, total] = await Promise.all([
    Animal.find(filter)
      .populate('pen', 'name type')
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Animal.countDocuments(filter)
  ]);

  // Convert to JSON to include virtuals
  const animalsWithVirtuals = animals.map(animal => animal.toJSON());

  return {
    data: animalsWithVirtuals,
    meta: getPaginationMeta(total, page, limit)
  };
};

/**
 * Get animals by Tag IDs (bulk lookup)
 */
const getByTagIds = async (tagIds) => {
  const cleaned = (Array.isArray(tagIds) ? tagIds : [])
    .map(t => String(t ?? '').trim().toUpperCase())
    .filter(Boolean);

  if (cleaned.length === 0) return [];

  const animals = await Animal.find({ tagId: { $in: cleaned } })
    .populate('pen', 'name type')
    .sort({ tagId: 1 });

  return animals.map(a => a.toJSON());
};

/**
 * Get animal by ID
 */
const getById = async (id) => {
  const animal = await Animal.findById(id)
    .populate('pen', 'name type capacity')
    .populate('sire', 'tagId name')
    .populate('dam', 'tagId name');

  if (!animal) {
    throw ApiError.notFound('Animal not found');
  }

  return animal;
};

/**
 * Create animal
 */
const create = async (animalData, userId) => {
  // Check for duplicate tagId
  if (animalData.tagId) {
    const existing = await Animal.findOne({ tagId: animalData.tagId });
    if (existing) {
      throw ApiError.conflict(`Animal with tag ID ${animalData.tagId} already exists`);
    }
  }

  // Validate pen exists and has capacity
  if (animalData.pen) {
    const pen = await Pen.findById(animalData.pen);
    if (!pen) {
      throw ApiError.notFound('Pen not found');
    }
    // Check pen capacity
    const currentAnimalCount = await Animal.countDocuments({ pen: animalData.pen, status: 'Active' });
    if (currentAnimalCount >= pen.capacity) {
      throw ApiError.badRequest(`Pen "${pen.name}" has reached its maximum capacity of ${pen.capacity} animals`);
    }
  }

  const animal = await Animal.create({
    ...animalData,
    createdBy: userId
  });

  const totalPurchaseCost =
    (animalData.purchasePrice || 0) +
    (animalData.purchaseTransport || 0) +
    (animalData.purchaseMandiExpenses || 0) +
    (animalData.purchaseFuel || 0) +
    (animalData.purchaseFood || 0) +
    (animalData.purchaseHotel || 0);

  // Deduct from capital
  try {
    const capital = await Capital.findOne({});
    if (capital && totalPurchaseCost > 0) {
      await capital.addTransaction(
        -totalPurchaseCost, // Negative because it's an investment/expense
        'Animal Purchase',
        `Animal ${animal.tagId} purchased`,
        animal._id,
        userId
      );
    }
  } catch (error) {
    // Log error but don't fail the request
    logger.error('Failed to update capital for animal purchase:', error);
  }

  // Create audit log
  logAction({
    userId,
    action: 'Animal Created',
    entityType: 'Animal',
    entityId: animal._id,
    metadata: {
      tagId: animal.tagId,
      name: animal.name,
      purchasePrice: animalData.purchasePrice,
      animalType: animal.animalType
    }
  });

  return animal.populate('pen', 'name type');
};

/**
 * Bulk create animals (optimized: batch DB ops instead of per-animal round-trips)
 */
const bulkCreate = async (animalsData, userId) => {
  const results = {
    success: [],
    failed: []
  };

  // --- 1. Batch pen capacity check (2 queries total instead of N) ---
  const uniquePenIds = [...new Set(
    animalsData.map(a => a.pen).filter(Boolean).map(String)
  )];

  const penCapacityMap = {};
  if (uniquePenIds.length > 0) {
    const [pens, penCounts] = await Promise.all([
      Pen.find({ _id: { $in: uniquePenIds } }).lean(),
      Animal.aggregate([
        { $match: { pen: { $in: uniquePenIds.map(id => new (require('mongoose').Types.ObjectId)(id)) }, status: 'Active' } },
        { $group: { _id: '$pen', count: { $sum: 1 } } }
      ])
    ]);

    const countMap = {};
    for (const c of penCounts) countMap[String(c._id)] = c.count;

    for (const pen of pens) {
      const id = String(pen._id);
      penCapacityMap[id] = {
        capacity: pen.capacity,
        current: countMap[id] || 0,
        name: pen.name,
        requestedCount: 0
      };
    }

    for (const a of animalsData) {
      if (a.pen && penCapacityMap[String(a.pen)]) {
        penCapacityMap[String(a.pen)].requestedCount++;
      }
    }

    for (const [, info] of Object.entries(penCapacityMap)) {
      if (info.current + info.requestedCount > info.capacity) {
        throw ApiError.badRequest(
          `Pen "${info.name}" would exceed capacity. Current: ${info.current}, Requested: ${info.requestedCount}, Capacity: ${info.capacity}`
        );
      }
    }
  }

  // --- 2. Batch duplicate tagId check (1 query instead of N) ---
  const allTagIds = animalsData.map(a => a.tagId).filter(Boolean);
  const existingAnimals = allTagIds.length > 0
    ? await Animal.find({ tagId: { $in: allTagIds } }).select('tagId').lean()
    : [];
  const existingTagSet = new Set(existingAnimals.map(a => a.tagId));

  // --- 3. Separate valid vs duplicate, then insertMany for valid ones ---
  const toInsert = [];
  let totalInvestment = 0;

  for (const animalData of animalsData) {
    if (animalData.tagId && existingTagSet.has(animalData.tagId)) {
      results.failed.push({ data: animalData, error: `Tag ID ${animalData.tagId} already exists` });
      continue;
    }
    toInsert.push({ ...animalData, createdBy: userId });
    totalInvestment += animalData.purchasePrice || 0;
  }

  if (toInsert.length > 0) {
    try {
      const inserted = await Animal.insertMany(toInsert, { ordered: false });
      results.success = inserted;
    } catch (err) {
      if (err.insertedDocs && err.insertedDocs.length > 0) {
        results.success = err.insertedDocs;
      }
      const writeErrors = err.writeErrors || [];
      for (const we of writeErrors) {
        const failedDoc = toInsert[we.index];
        results.failed.push({ data: failedDoc, error: we.errmsg || we.message || 'Insert failed' });
      }
    }
  }

  // Single audit log for the entire bulk operation
  if (results.success.length > 0) {
    logAction({
      userId,
      action: 'Animal Bulk Created',
      entityType: 'Animal',
      entityId: results.success[0]._id,
      metadata: {
        count: results.success.length,
        totalInvestment,
        bulkImport: true
      }
    });
  }

  // Deduct total from capital after all successful creations
  if (results.success.length > 0 && totalInvestment > 0) {
    try {
      const capital = await Capital.findOne({});
      if (capital) {
        await capital.addTransaction(
          -totalInvestment,
          'Animal Purchase',
          `Bulk import: ${results.success.length} animals purchased for total amount ${totalInvestment}`,
          null,
          userId
        );
      }
    } catch (error) {
      logger.error('Failed to update capital for bulk animal purchase:', error);
    }
  }

  return results;
};

/**
 * Update animal
 */
const update = async (id, updateData, userId) => {
  // Check for duplicate tagId if being changed
  if (updateData.tagId) {
    const existing = await Animal.findOne({ 
      tagId: updateData.tagId, 
      _id: { $ne: id } 
    });
    if (existing) {
      throw ApiError.conflict(`Animal with tag ID ${updateData.tagId} already exists`);
    }
  }

  // Validate pen exists
  if (updateData.pen) {
    const pen = await Pen.findById(updateData.pen);
    if (!pen) {
      throw ApiError.notFound('Pen not found');
    }
  }

  const animal = await Animal.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true, runValidators: true }
  ).populate('pen', 'name type');

  if (!animal) {
    throw ApiError.notFound('Animal not found');
  }

  // Create audit log
  logAction({
    userId,
    action: 'Animal Updated',
    entityType: 'Animal',
    entityId: animal._id,
    metadata: {
      tagId: animal.tagId,
      name: animal.name,
      changes: updateData
    }
  });

  return animal;
};

/**
 * Delete animal
 */
const remove = async (id, userId) => {
  const animal = await Animal.findById(id);

  if (!animal) {
    throw ApiError.notFound('Animal not found');
  }

  // Reverse capital transaction if animal was not sold
  try {
    if (animal.status !== 'Sold') {
      // Calculate total cost including expenses
      const totalCost = (animal.purchasePrice || 0) +
        (animal.purchaseTransport || 0) +
        (animal.purchaseMandiExpenses || 0) +
        (animal.purchaseFuel || 0) +
        (animal.purchaseFood || 0) +
        (animal.purchaseHotel || 0);

      if (totalCost > 0) {
        const capital = await Capital.getOrCreate(userId);
        const description = `Animal deletion reversal - ${animal.tagId} (${animal.name})`;
        await capital.addTransaction(totalCost, 'Animal Deletion Reversal', description, String(animal._id), userId);
      }
    }
  } catch (err) {
    // Log error but continue with deletion
    logger.error('Failed to reverse capital transaction for animal:', err.message || err);
  }

  await Animal.findByIdAndDelete(id);

  // Create audit log
  logAction({
    userId,
    action: 'Animal Deleted',
    entityType: 'Animal',
    entityId: animal._id,
    metadata: {
      tagId: animal.tagId,
      name: animal.name,
      purchasePrice: animal.purchasePrice
    }
  });

  return animal;
};

/**
 * Move animal to pen
 */
const moveToPen = async (animalId, penId, userId) => {
  const [animal, pen] = await Promise.all([
    Animal.findById(animalId),
    Pen.findById(penId)
  ]);

  if (!animal) {
    throw ApiError.notFound('Animal not found');
  }

  if (!pen) {
    throw ApiError.notFound('Pen not found');
  }

  // Check pen capacity
  const currentCount = await Animal.countDocuments({ pen: penId, status: 'Active' });
  if (currentCount >= pen.capacity) {
    throw ApiError.badRequest('Pen is at full capacity');
  }

  const oldPenId = animal.pen;
  animal.pen = penId;
  await animal.save();

  // Create audit log
  logAction({
    userId,
    action: 'Animal Moved to Pen',
    entityType: 'Animal',
    entityId: animal._id,
    metadata: {
      tagId: animal.tagId,
      name: animal.name,
      fromPen: oldPenId,
      toPen: penId,
      penName: pen.name
    }
  });

  return animal.populate('pen', 'name type capacity');
};

/**
 * Get animals by pen
 */
const getByPen = async (penId) => {
  const animals = await Animal.find({ pen: penId, status: 'Active' })
    .sort({ tagId: 1 });

  return animals;
};

/**
 * Declare animal as dead; full cost is recorded as loss (no distribution to other animals)
 */
const declareDead = async (id, deathData, userId) => {
  const animal = await Animal.findById(id);

  if (!animal) {
    throw ApiError.notFound('Animal not found');
  }

  if (animal.status === 'Dead') {
    throw ApiError.badRequest('Animal is already marked as dead');
  }

  // Calculate the animal's total cost (total purchase cost + all operational costs)
  const animalTotalCost = animal.totalPurchaseCost +
    (animal.totalFeedCost || 0) +
    (animal.totalHealthCost || 0) +
    (animal.totalVaccinationCost || 0) +
    (animal.totalDewormingCost || 0) +
    (animal.totalSalaryCost || 0);

  // Mark animal as dead
  animal.status = 'Dead';
  animal.deathDate = deathData.deathDate || new Date();
  animal.deathReason = deathData.deathReason || '';
  await animal.save();

  // Record full cost as loss in capital (no balance change)
  if (animalTotalCost > 0 && userId) {
    try {
      const capital = await Capital.getOrCreate(userId);
      await capital.addLoss(
        animalTotalCost,
        `Animal death: ${animal.tagId || animal.name || id} - ${deathData.deathReason || 'N/A'}`,
        String(animal._id),
        userId
      );
    } catch (err) {
      logger.error('Failed to record capital loss for dead animal:', err.message || err);
    }
  }

  // Create audit log
  logAction({
    userId,
    action: 'Animal Declared Dead',
    entityType: 'Animal',
    entityId: animal._id,
    metadata: {
      tagId: animal.tagId,
      name: animal.name,
      deathDate: animal.deathDate,
      deathReason: animal.deathReason,
      lossRecorded: animalTotalCost
    }
  });

  return {
    animal,
    lossRecorded: animalTotalCost
  };
};

/**
 * Mark single animal as sold.
 * Capital: cost returns to available balance; profit covers loss first, then adds to profit.
 */
const markAsSold = async (id, saleData, userId) => {
  const animal = await Animal.findById(id);

  if (!animal) {
    throw ApiError.notFound('Animal not found');
  }

  if (animal.status === 'Sold') {
    throw ApiError.badRequest('Animal is already marked as sold');
  }

  const totalCost = animal.totalPurchaseCost +
    (animal.totalFeedCost || 0) +
    (animal.totalHealthCost || 0) +
    (animal.totalVaccinationCost || 0) +
    (animal.totalDewormingCost || 0) +
    (animal.totalSalaryCost || 0);
  const sellingPrice = Number(saleData.sellingPrice) || 0; // what we receive from buyer
  const sellingCost = Number(saleData.sellingCost) || 0;   // our expense (transport, etc.)

  // Mark animal as sold (soldPrice = what we receive, sellingCost stored separately)
  animal.status = 'Sold';
  animal.soldDate = saleData.soldDate || new Date();
  animal.soldPrice = sellingPrice;
  animal.soldCost = sellingCost;
  await animal.save();

  const profitFromSale = sellingPrice - totalCost - sellingCost;

  if (userId) {
    try {
      const capital = await Capital.getOrCreate(userId);
      await capital.recordAnimalSale(
        totalCost,
        sellingPrice,
        `Animal sale: ${animal.tagId || animal.name || id}`,
        String(animal._id),
        userId,
        sellingCost
      );
    } catch (err) {
      logger.error('Failed to record capital for animal sale:', err.message || err);
    }
  }

  // Create audit log
  logAction({
    userId,
    action: 'Animal Marked as Sold',
    entityType: 'Animal',
    entityId: animal._id,
    metadata: {
      tagId: animal.tagId,
      name: animal.name,
      soldDate: animal.soldDate,
      soldPrice: sellingPrice,
      soldCost: sellingCost,
      totalCost: totalCost,
      profit: profitFromSale
    }
  });

  return {
    animal,
    totalCost,
    sellingPrice,
    soldCost: sellingCost,
    profit: profitFromSale
  };
};

/**
 * Bulk mark animals as sold. Capital updated per sale (cost to balance, profit to loss then profit).
 */
const bulkMarkAsSold = async (animalsData, userId) => {
  const results = {
    success: [],
    failed: []
  };

  // Aggregate totals for capital transaction
  let aggregatedTotalCost = 0;
  let aggregatedSellingPrice = 0;
  let aggregatedSellingCost = 0;
  const successfulAnimals = [];

  for (const saleItem of animalsData) {
    try {
      let animal;
      if (saleItem.animalId) {
        animal = await Animal.findById(saleItem.animalId);
      } else if (saleItem.tagId) {
        animal = await Animal.findOne({ tagId: saleItem.tagId });
      }

      if (!animal) {
        results.failed.push({
          ...saleItem,
          error: `Animal not found: ${saleItem.animalId || saleItem.tagId}`
        });
        continue;
      }

      if (animal.status === 'Sold') {
        results.failed.push({
          ...saleItem,
          tagId: animal.tagId,
          error: 'Animal is already marked as sold'
        });
        continue;
      }

      const totalCost = animal.totalPurchaseCost +
        (animal.totalFeedCost || 0) +
        (animal.totalHealthCost || 0) +
        (animal.totalVaccinationCost || 0) +
        (animal.totalDewormingCost || 0) +
        (animal.totalSalaryCost || 0);
      const sellingPrice = saleItem.sellingPrice || 0;
      const sellingCost = Number(saleItem.sellingCost) || 0;
      const profitFromSale = sellingPrice - totalCost - sellingCost;

      animal.status = 'Sold';
      animal.soldDate = saleItem.soldDate || new Date();
      animal.soldPrice = sellingPrice;
      animal.soldCost = sellingCost;
      await animal.save();

      // Accumulate for aggregated capital transaction
      aggregatedTotalCost += totalCost;
      aggregatedSellingPrice += sellingPrice;
      aggregatedSellingCost += sellingCost;
      successfulAnimals.push({
        animalId: animal._id,
        tagId: animal.tagId,
        name: animal.name,
        totalCost,
        sellingPrice,
        profit: profitFromSale
      });

      // Create audit log for each sale
      logAction({
        userId,
        action: 'Animal Bulk Marked as Sold',
        entityType: 'Animal',
        entityId: animal._id,
        metadata: {
          tagId: animal.tagId,
          name: animal.name,
          soldDate: animal.soldDate,
          soldPrice: sellingPrice,
          soldCost: sellingCost,
          totalCost: totalCost,
          profit: profitFromSale,
          bulkOperation: true
        }
      });

      results.success.push({
        animalId: animal._id,
        tagId: animal.tagId,
        name: animal.name,
        totalCost,
        sellingPrice,
        profit: profitFromSale
      });
    } catch (error) {
      results.failed.push({
        ...saleItem,
        error: error.message
      });
    }
  }

  // Create single aggregated capital transaction for all successful sales
  if (userId && successfulAnimals.length > 0) {
    try {
      const capital = await Capital.getOrCreate(userId);
      await capital.recordAnimalSale(
        aggregatedTotalCost,
        aggregatedSellingPrice,
        `Bulk animal sale: ${successfulAnimals.length} animal(s)`,
        null, // entityId null for aggregated transaction
        userId,
        aggregatedSellingCost
      );
    } catch (err) {
      logger.error('Failed to record aggregated capital for bulk animal sale:', err.message || err);
    }
  }

  return results;
};

/**
 * Recalculate animal costs (maintenance function for denormalized fields)
 */
const recalculateCosts = async (id) => {
  const animal = await Animal.recalculateCosts(id);

  if (!animal) {
    throw ApiError.notFound('Animal not found');
  }

  return animal;
};

module.exports = {
  getAll,
  getById,
  create,
  bulkCreate,
  update,
  remove,
  moveToPen,
  getByPen,
  declareDead,
  markAsSold,
  bulkMarkAsSold,
  recalculateCosts,
  getByTagIds
};
