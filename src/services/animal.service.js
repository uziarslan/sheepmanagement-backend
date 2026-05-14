const {
  Animal,
  Pen,
  Capital,
  Treatment,
  Deworming,
  Vaccination,
  VaccineApplication,
  WeightRecord,
  TemperatureRecord,
  BcsRecord,
  HoofRecord,
  ShearingRecord
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
 * Create animal.
 *
 * Atomic: animal insert + capital deduction commit together (or both abort).
 * On standalone Mongo, falls back to non-transactional execution but still
 * uses atomic capital ops so the second write is race-safe.
 */
const create = async (animalData, userId) => {
  // Check for duplicate tagId
  if (animalData.tagId) {
    const existing = await Animal.findOne({ tagId: animalData.tagId });
    if (existing) {
      throw ApiError.conflict(`Animal with tag ID ${animalData.tagId} already exists`);
    }
  }

  // Validate pen exists and has capacity (pre-check; capacity race window remains
  // because we can't atomically conditional-insert based on a count — but the
  // window is now small relative to the rest of the flow).
  if (animalData.pen) {
    const pen = await Pen.findById(animalData.pen);
    if (!pen) {
      throw ApiError.notFound('Pen not found');
    }
    const currentAnimalCount = await Animal.countDocuments({ pen: animalData.pen, status: 'Active' });
    if (currentAnimalCount >= pen.capacity) {
      throw ApiError.badRequest(`Pen "${pen.name}" has reached its maximum capacity of ${pen.capacity} animals`);
    }
  }

  const totalPurchaseCost =
    (animalData.purchasePrice || 0) +
    (animalData.purchaseTransport || 0) +
    (animalData.purchaseMandiExpenses || 0) +
    (animalData.purchaseFuel || 0) +
    (animalData.purchaseFood || 0) +
    (animalData.purchaseHotel || 0);

  const animal = await withTransaction(async (session) => {
    const [created] = await Animal.create(
      [{ ...animalData, createdBy: userId }],
      session ? { session } : {}
    );

    if (totalPurchaseCost > 0) {
      const result = await Capital.atomicAddTransaction({
        amount: -totalPurchaseCost,
        type: 'Animal Purchase',
        description: `Animal ${created.tagId} purchased`,
        reference: String(created._id),
        createdBy: userId
      }, session);
      if (!result) {
        // Capital singleton missing → abort the create so we don't leave a
        // purchased animal with no capital event.
        throw ApiError.badRequest(
          'Capital not initialized. Initialize capital before recording animal purchases.'
        );
      }
    }

    return created;
  });

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

  if (toInsert.length === 0) {
    return results;
  }

  // Insert + capital deduction inside a transaction so the aggregated capital
  // line matches only the animals that were actually persisted.
  // A4 fix: re-derive totalInvestment from `inserted`, not from `toInsert`.
  await withTransaction(async (session) => {
    let inserted = [];
    try {
      inserted = await Animal.insertMany(toInsert, {
        ordered: false,
        ...(session ? { session } : {})
      });
    } catch (err) {
      if (err.insertedDocs && err.insertedDocs.length > 0) {
        inserted = err.insertedDocs;
      }
      const writeErrors = err.writeErrors || [];
      for (const we of writeErrors) {
        const failedDoc = toInsert[we.index];
        results.failed.push({ data: failedDoc, error: we.errmsg || we.message || 'Insert failed' });
      }
    }
    results.success = inserted;

    // Derive the capital deduction from the actually-persisted animals only.
    const insertedInvestment = inserted.reduce(
      (sum, a) => sum + (a.purchasePrice || 0), 0
    );

    if (insertedInvestment > 0) {
      const result = await Capital.atomicAddTransaction({
        amount: -insertedInvestment,
        type: 'Animal Purchase',
        description: `Bulk import: ${inserted.length} animal(s) for total ${insertedInvestment}`,
        reference: null,
        createdBy: userId
      }, session);
      if (!result) {
        throw ApiError.badRequest(
          'Capital not initialized. Initialize capital before bulk-importing animals.'
        );
      }
    }
  });

  // Audit log: one summary entry + one per-animal entry. Bulk ops used to log
  // only the first inserted ID with `{count: N}`; that lost per-animal trail.
  if (results.success.length > 0) {
    const totalInvestment = results.success.reduce(
      (s, a) => s + (a.purchasePrice || 0), 0
    );

    logAction({
      userId,
      action: 'Animal Bulk Create Summary',
      entityType: 'Animal',
      entityId: results.success[0]._id,
      metadata: {
        count: results.success.length,
        failedCount: results.failed.length,
        totalInvestment,
        bulkImport: true
      }
    });

    // Per-entity entries — keep them lean (no full doc dump).
    for (const a of results.success) {
      logAction({
        userId,
        action: 'Animal Created',
        entityType: 'Animal',
        entityId: a._id,
        metadata: {
          tagId: a.tagId,
          animalType: a.animalType,
          purchasePrice: a.purchasePrice,
          bulkImport: true
        }
      });
    }
  }

  return results;
};

/**
 * Update animal.
 *
 * Defense in depth: even if a caller bypasses Joi, strip fields that must
 * not flow through the generic update path. Lifecycle transitions go through
 * markAsSold / declareDead; purchase-cost edits need a synced capital
 * adjustment (not implemented yet).
 */
const PROTECTED_UPDATE_FIELDS = [
  'purchasePrice',
  'purchaseTransport',
  'purchaseMandiExpenses',
  'purchaseFuel',
  'purchaseFood',
  'purchaseHotel',
  'soldDate',
  'soldPrice',
  'soldCost',
  'deathDate',
  'deathReason',
  'totalFeedCost',
  'totalHealthCost',
  'totalVaccinationCost',
  'totalDewormingCost',
  'totalSalaryCost'
];
const BLOCKED_STATUSES_VIA_UPDATE = ['Sold', 'Dead', 'Slaughtered'];

const update = async (id, updateData, userId) => {
  // Strip protected fields
  const sanitized = { ...updateData };
  for (const f of PROTECTED_UPDATE_FIELDS) delete sanitized[f];

  // Block lifecycle status transitions via generic update
  if (sanitized.status && BLOCKED_STATUSES_VIA_UPDATE.includes(sanitized.status)) {
    throw ApiError.badRequest(
      `Cannot change status to '${sanitized.status}' via update. ` +
      `Use mark-sold or declare-dead instead.`
    );
  }

  // Capture before-state for AL3 audit diff.
  const beforeDoc = await Animal.findById(id).lean();
  if (!beforeDoc) throw ApiError.notFound('Animal not found');

  // Check for duplicate tagId if being changed
  if (sanitized.tagId) {
    const existing = await Animal.findOne({
      tagId: sanitized.tagId,
      _id: { $ne: id }
    });
    if (existing) {
      throw ApiError.conflict(`Animal with tag ID ${sanitized.tagId} already exists`);
    }
  }

  // Validate pen exists AND has capacity if changing
  if (sanitized.pen) {
    const current = await Animal.findById(id).select('pen status');
    if (!current) throw ApiError.notFound('Animal not found');

    const isPenChange = String(current.pen) !== String(sanitized.pen);
    if (isPenChange) {
      const pen = await Pen.findById(sanitized.pen);
      if (!pen) throw ApiError.notFound('Pen not found');

      // Only enforce capacity when the animal will count toward occupancy
      const willBeActive = (sanitized.status || current.status) === 'Active';
      if (willBeActive) {
        const occupancy = await Animal.countDocuments({
          pen: sanitized.pen,
          status: 'Active',
          _id: { $ne: id }
        });
        if (occupancy >= pen.capacity) {
          throw ApiError.badRequest(
            `Pen "${pen.name}" has reached its maximum capacity of ${pen.capacity} animals`
          );
        }
      }
    }
  }

  const animal = await Animal.findByIdAndUpdate(
    id,
    { $set: sanitized },
    { new: true, runValidators: true }
  ).populate('pen', 'name type');

  if (!animal) {
    throw ApiError.notFound('Animal not found');
  }

  // Audit: before/after diff over the fields the caller tried to change.
  // AL3 fix — raw `updateData` doesn't tell you what actually moved.
  const changedKeys = Object.keys(sanitized);
  const diff = diffFields(beforeDoc, animal.toObject ? animal.toObject() : animal, changedKeys);

  logAction({
    userId,
    action: 'Animal Updated',
    entityType: 'Animal',
    entityId: animal._id,
    metadata: {
      tagId: animal.tagId,
      name: animal.name,
      diff
    }
  });

  return animal;
};

/**
 * Delete animal.
 *
 * Sprint 3 (A15/A16):
 *  - Block delete if this animal is referenced as sire or dam of another
 *    (would orphan a pedigree pointer with no good recovery).
 *  - Cascade-delete singly-owned care records (Treatment, Deworming,
 *    Weight/Temp/BCS/Hoof/Shearing) — these have no meaning without the
 *    animal and would otherwise dangle.
 *  - $pull this animal from multi-animal aggregate records (Vaccination,
 *    VaccineApplication) so populate() doesn't return null entries.
 *  - All in one transaction so a mid-flight crash leaves nothing half-done.
 *
 * Sprint 5 (A14/C4):
 *  - Block delete of Sold animals — sale was already booked into capital
 *    (profit/loss apportioned). Deleting without reversing would either
 *    double-count (re-create same animal later) or leave orphaned ledger
 *    entries pointing at a missing animal.
 *  - Block delete of Dead animals — death loss was booked into capital.loss.
 *    Same reasoning.
 *  - Caller must explicitly restore-from-sold or restore-from-dead first,
 *    which reverses the capital impact correctly. Then delete is safe.
 */
const remove = async (id, userId) => {
  const snapshot = await Animal.findById(id);
  if (!snapshot) throw ApiError.notFound('Animal not found');

  // A14/C4: forbid deletion of animals whose lifecycle has booked financial
  // events. Force a reversal-first workflow.
  if (snapshot.status === 'Sold') {
    throw ApiError.badRequest(
      `Cannot delete ${snapshot.tagId} — it is Sold and the sale is recorded in ` +
      `capital. Restore it first (PUT /api/animals/:id/restore-from-sold) ` +
      `which reverses the capital sale, then delete.`
    );
  }
  if (snapshot.status === 'Dead') {
    throw ApiError.badRequest(
      `Cannot delete ${snapshot.tagId} — it is Dead and the loss is recorded in ` +
      `capital. Restore it first (PUT /api/animals/:id/restore-from-dead) ` +
      `which reverses the capital loss, then delete.`
    );
  }

  // Lineage protection — pedigree links would silently break otherwise.
  const lineageCount = await Animal.countDocuments({
    $or: [{ sire: id }, { dam: id }]
  });
  if (lineageCount > 0) {
    throw ApiError.badRequest(
      `Cannot delete ${snapshot.tagId} — it is recorded as a parent (sire/dam) ` +
      `of ${lineageCount} animal(s). Unlink the children first or mark this ` +
      `animal as Sold/Dead instead of deleting.`
    );
  }

  const totalPurchaseCost = (snapshot.purchasePrice || 0) +
    (snapshot.purchaseTransport || 0) +
    (snapshot.purchaseMandiExpenses || 0) +
    (snapshot.purchaseFuel || 0) +
    (snapshot.purchaseFood || 0) +
    (snapshot.purchaseHotel || 0);

  const cascadeCounts = await withTransaction(async (session) => {
    if (snapshot.status !== 'Sold' && totalPurchaseCost > 0) {
      await Capital.atomicAddTransaction({
        amount: totalPurchaseCost,
        type: 'Animal Deletion Reversal',
        description: `Animal deletion reversal - ${snapshot.tagId} (${snapshot.name || ''})`,
        reference: String(snapshot._id),
        createdBy: userId
      }, session);
    }

    const sessOpt = session ? { session } : {};

    // 1) Singly-owned care records → cascade hard-delete.
    const [tx, dw, wt, tp, bc, hf, sh] = await Promise.all([
      Treatment.deleteMany({ animal: id }, sessOpt),
      Deworming.deleteMany({ animal: id }, sessOpt),
      WeightRecord.deleteMany({ animal: id }, sessOpt),
      TemperatureRecord.deleteMany({ animal: id }, sessOpt),
      BcsRecord.deleteMany({ animal: id }, sessOpt),
      HoofRecord.deleteMany({ animal: id }, sessOpt),
      ShearingRecord.deleteMany({ animal: id }, sessOpt)
    ]);

    // 2) Legacy Vaccination model: delete if singularly tied; $pull from
    //    multi-animal arrays where this animal is one of many.
    const [vacSingular, vacArrayPull] = await Promise.all([
      Vaccination.deleteMany({ animal: id }, sessOpt),
      Vaccination.updateMany(
        { animals: id },
        { $pull: { animals: id } },
        sessOpt
      )
    ]);

    // 3) New VaccineApplication model — same treatment.
    const [vapSingular, vapArrayPull] = await Promise.all([
      VaccineApplication.deleteMany({ animal: id }, sessOpt),
      VaccineApplication.updateMany(
        { animals: id },
        { $pull: { animals: id } },
        sessOpt
      )
    ]);

    const deleted = await Animal.findByIdAndDelete(id, sessOpt);
    if (!deleted) {
      throw ApiError.notFound('Animal not found');
    }

    return {
      treatments: tx.deletedCount || 0,
      dewormings: dw.deletedCount || 0,
      weightRecords: wt.deletedCount || 0,
      temperatureRecords: tp.deletedCount || 0,
      bcsRecords: bc.deletedCount || 0,
      hoofRecords: hf.deletedCount || 0,
      shearingRecords: sh.deletedCount || 0,
      vaccinationsSingular: vacSingular.deletedCount || 0,
      vaccinationsArrayPulled: vacArrayPull.modifiedCount || 0,
      vaccineApplicationsSingular: vapSingular.deletedCount || 0,
      vaccineApplicationsArrayPulled: vapArrayPull.modifiedCount || 0
    };
  });

  logAction({
    userId,
    action: 'Animal Deleted',
    entityType: 'Animal',
    entityId: snapshot._id,
    metadata: {
      tagId: snapshot.tagId,
      name: snapshot.name,
      purchasePrice: snapshot.purchasePrice,
      cascade: cascadeCounts
    }
  });

  return snapshot;
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
 * Declare animal as dead; full cost is recorded as loss (no distribution to other animals).
 * Atomic: status flip + capital loss line commit together.
 */
const declareDead = async (id, deathData, userId) => {
  // Snapshot total cost outside the transaction so the audit log has it.
  const snapshot = await Animal.findById(id);
  if (!snapshot) throw ApiError.notFound('Animal not found');
  if (snapshot.status === 'Dead') throw ApiError.badRequest('Animal is already marked as dead');

  const animalTotalCost = snapshot.totalPurchaseCost +
    (snapshot.totalFeedCost || 0) +
    (snapshot.totalHealthCost || 0) +
    (snapshot.totalVaccinationCost || 0) +
    (snapshot.totalDewormingCost || 0) +
    (snapshot.totalSalaryCost || 0);

  const animal = await withTransaction(async (session) => {
    // Atomic transition: only flip if still not Dead. Prevents two parallel
    // declare-dead requests from each adding the loss twice.
    const updated = await Animal.findOneAndUpdate(
      { _id: id, status: { $ne: 'Dead' } },
      {
        $set: {
          status: 'Dead',
          deathDate: deathData.deathDate || new Date(),
          deathReason: deathData.deathReason || ''
        }
      },
      { new: true, ...(session ? { session } : {}) }
    );
    if (!updated) {
      throw ApiError.badRequest('Animal is already marked as dead or no longer exists');
    }

    if (animalTotalCost > 0) {
      await Capital.atomicAddLoss({
        amount: animalTotalCost,
        type: 'Animal Death',
        description: `Animal death: ${updated.tagId || updated.name || id} - ${deathData.deathReason || 'N/A'}`,
        reference: String(updated._id),
        createdBy: userId
      }, session);
    }

    return updated;
  });

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

  return { animal, lossRecorded: animalTotalCost };
};

/**
 * Mark single animal as sold.
 * Atomic: status flip + capital sale entry commit together.
 */
const markAsSold = async (id, saleData, userId) => {
  const snapshot = await Animal.findById(id);
  if (!snapshot) throw ApiError.notFound('Animal not found');
  if (snapshot.status === 'Sold') throw ApiError.badRequest('Animal is already marked as sold');

  const totalCost = snapshot.totalPurchaseCost +
    (snapshot.totalFeedCost || 0) +
    (snapshot.totalHealthCost || 0) +
    (snapshot.totalVaccinationCost || 0) +
    (snapshot.totalDewormingCost || 0) +
    (snapshot.totalSalaryCost || 0);
  const sellingPrice = Number(saleData.sellingPrice) || 0;
  const sellingCost = Number(saleData.sellingCost) || 0;
  const profitFromSale = sellingPrice - totalCost - sellingCost;

  const animal = await withTransaction(async (session) => {
    const updated = await Animal.findOneAndUpdate(
      { _id: id, status: { $ne: 'Sold' } },
      {
        $set: {
          status: 'Sold',
          soldDate: saleData.soldDate || new Date(),
          soldPrice: sellingPrice,
          soldCost: sellingCost
        }
      },
      { new: true, ...(session ? { session } : {}) }
    );
    if (!updated) {
      throw ApiError.badRequest('Animal is already marked as sold or no longer exists');
    }

    await Capital.atomicRecordAnimalSale({
      totalCost,
      sellingPrice,
      sellingCost,
      description: `Animal sale: ${updated.tagId || updated.name || id}`,
      reference: String(updated._id),
      createdBy: userId
    }, session);

    return updated;
  });

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
      totalCost,
      profit: profitFromSale
    }
  });

  return { animal, totalCost, sellingPrice, soldCost: sellingCost, profit: profitFromSale };
};

/**
 * Bulk mark animals as sold.
 *
 * Sprint 3 (A27): now calls atomicRecordAnimalSale ONCE PER ANIMAL inside the
 * transaction, so the profit-vs-loss apportionment (profit covers loss first
 * per animal) matches the behavior of selling each animal one-by-one.
 *
 * Trade-off: N capital writes instead of 1. For bulk-of-thousands this is
 * slower; correctness > throughput for financial records.
 */
const bulkMarkAsSold = async (animalsData, userId) => {
  const results = { success: [], failed: [] };

  await withTransaction(async (session) => {
    for (const saleItem of animalsData) {
      try {
        let lookup;
        if (saleItem.animalId) {
          lookup = { _id: saleItem.animalId, status: { $ne: 'Sold' } };
        } else if (saleItem.tagId) {
          lookup = { tagId: saleItem.tagId, status: { $ne: 'Sold' } };
        } else {
          results.failed.push({ ...saleItem, error: 'animalId or tagId required' });
          continue;
        }

        const sellingPrice = saleItem.sellingPrice || 0;
        const sellingCost = Number(saleItem.sellingCost) || 0;
        const soldDate = saleItem.soldDate || new Date();

        const animal = await Animal.findOneAndUpdate(
          lookup,
          {
            $set: {
              status: 'Sold',
              soldDate,
              soldPrice: sellingPrice,
              soldCost: sellingCost
            }
          },
          { new: true, ...(session ? { session } : {}) }
        );

        if (!animal) {
          const probe = saleItem.animalId
            ? await Animal.findById(saleItem.animalId).session(session || null).lean()
            : await Animal.findOne({ tagId: saleItem.tagId }).session(session || null).lean();
          results.failed.push({
            ...saleItem,
            tagId: probe?.tagId,
            error: probe
              ? (probe.status === 'Sold' ? 'Animal is already marked as sold' : 'Animal not eligible')
              : `Animal not found: ${saleItem.animalId || saleItem.tagId}`
          });
          continue;
        }

        const totalCost = (animal.purchasePrice || 0) +
          (animal.purchaseTransport || 0) + (animal.purchaseMandiExpenses || 0) +
          (animal.purchaseFuel || 0) + (animal.purchaseFood || 0) + (animal.purchaseHotel || 0) +
          (animal.totalFeedCost || 0) +
          (animal.totalHealthCost || 0) +
          (animal.totalVaccinationCost || 0) +
          (animal.totalDewormingCost || 0) +
          (animal.totalSalaryCost || 0);
        const profitFromSale = sellingPrice - totalCost - sellingCost;

        // Per-animal capital sale — preserves correct profit-vs-loss math.
        await Capital.atomicRecordAnimalSale({
          totalCost,
          sellingPrice,
          sellingCost,
          description: `Animal sale (bulk): ${animal.tagId || animal.name || animal._id}`,
          reference: String(animal._id),
          createdBy: userId
        }, session);

        logAction({
          userId,
          action: 'Animal Bulk Marked as Sold',
          entityType: 'Animal',
          entityId: animal._id,
          metadata: {
            tagId: animal.tagId, name: animal.name,
            soldDate: animal.soldDate, soldPrice: sellingPrice,
            soldCost: sellingCost, totalCost, profit: profitFromSale,
            bulkOperation: true
          }
        });

        results.success.push({
          animalId: animal._id, tagId: animal.tagId, name: animal.name,
          totalCost, sellingPrice, profit: profitFromSale
        });
      } catch (error) {
        results.failed.push({ ...saleItem, error: error.message });
      }
    }
  });

  return results;
};

/**
 * Restore an animal from Dead status (A21).
 *
 * Use case: a death was declared by mistake — the animal is alive after all.
 * Reverses the capital loss entry and flips status back to 'Active'.
 *
 * Loss reversal is clamped (we never push capital.loss below zero). If the
 * recorded death-loss has already been "consumed" by a subsequent sale's
 * profit, we reverse only what remains in `capital.loss`. The ledger entry
 * shows the full intended reversal so reconciliation is traceable.
 */
const restoreFromDead = async (id, userId) => {
  const animal = await Animal.findById(id);
  if (!animal) throw ApiError.notFound('Animal not found');
  if (animal.status !== 'Dead') {
    throw ApiError.badRequest(`Animal is not Dead (current status: ${animal.status})`);
  }

  // Re-compute the loss amount the way declareDead did, so we reverse the
  // same number even if costs have drifted since.
  const recordedLoss = animal.totalPurchaseCost +
    (animal.totalFeedCost || 0) +
    (animal.totalHealthCost || 0) +
    (animal.totalVaccinationCost || 0) +
    (animal.totalDewormingCost || 0) +
    (animal.totalSalaryCost || 0);

  const restored = await withTransaction(async (session) => {
    const updated = await Animal.findOneAndUpdate(
      { _id: id, status: 'Dead' },
      {
        $set: { status: 'Active' },
        $unset: { deathDate: 1, deathReason: 1 }
      },
      { new: true, ...(session ? { session } : {}) }
    );
    if (!updated) {
      throw ApiError.badRequest('Animal status changed concurrently; aborting.');
    }

    if (recordedLoss > 0) {
      await Capital.atomicReverseLoss({
        amount: recordedLoss,
        type: 'Animal Death Reversal',
        description: `Death reversed for ${updated.tagId || updated.name || id}`,
        reference: String(updated._id),
        createdBy: userId
      }, session);
    }

    return updated;
  });

  logAction({
    userId,
    action: 'Animal Death Reversed',
    entityType: 'Animal',
    entityId: restored._id,
    metadata: {
      tagId: restored.tagId,
      name: restored.name,
      lossReversed: recordedLoss
    }
  });

  return { animal: restored, lossReversed: recordedLoss };
};

/**
 * Restore an animal from Sold status (A25).
 *
 * Use case: a sale was recorded by mistake — the animal hasn't actually been
 * sold. Reverses the capital sale (returns sale proceeds, restores invested,
 * undoes the profit/loss apportionment) and clears sold fields.
 */
const restoreFromSold = async (id, userId) => {
  const animal = await Animal.findById(id);
  if (!animal) throw ApiError.notFound('Animal not found');
  if (animal.status !== 'Sold') {
    throw ApiError.badRequest(`Animal is not Sold (current status: ${animal.status})`);
  }

  const totalCost = animal.totalPurchaseCost +
    (animal.totalFeedCost || 0) +
    (animal.totalHealthCost || 0) +
    (animal.totalVaccinationCost || 0) +
    (animal.totalDewormingCost || 0) +
    (animal.totalSalaryCost || 0);
  const sellingPrice = animal.soldPrice || 0;
  const sellingCost = animal.soldCost || 0;

  const restored = await withTransaction(async (session) => {
    const updated = await Animal.findOneAndUpdate(
      { _id: id, status: 'Sold' },
      {
        $set: { status: 'Active' },
        $unset: { soldDate: 1, soldPrice: 1, soldCost: 1 }
      },
      { new: true, ...(session ? { session } : {}) }
    );
    if (!updated) {
      throw ApiError.badRequest('Animal status changed concurrently; aborting.');
    }

    await Capital.atomicReverseAnimalSale({
      totalCost,
      sellingPrice,
      sellingCost,
      description: `Sale reversed for ${updated.tagId || updated.name || id}`,
      reference: String(updated._id),
      createdBy: userId
    }, session);

    return updated;
  });

  logAction({
    userId,
    action: 'Animal Sale Reversed',
    entityType: 'Animal',
    entityId: restored._id,
    metadata: {
      tagId: restored.tagId,
      name: restored.name,
      sellingPrice,
      sellingCost,
      totalCost
    }
  });

  return { animal: restored, totalCost, sellingPrice, sellingCost };
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
  restoreFromDead,
  restoreFromSold,
  recalculateCosts,
  getByTagIds
};
