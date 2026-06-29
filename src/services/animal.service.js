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
const mongoose = require('mongoose');
const {
  ApiError,
  getPaginationOptions,
  getSortOptions,
  getPaginationMeta,
  logAction,
  logActionBatch,
  withTransaction,
  diffFields,
  animalCosts
} = require('../utils');

// Source statuses from which an animal may transition to Sold / Dead. Terminal
// states (Sold/Dead/Slaughtered) are excluded so a Dead animal can't be sold and
// a Sold animal can't be declared dead — both would double-book capital
// (audit C-1/C-2). 'Returned' is included so legacy returned animals aren't
// stranded; it has no other lifecycle handling.
const LIFECYCLE_ELIGIBLE_STATUSES = ['Active', 'Quarantine', 'Returned'];
// Financially-terminal statuses whose capital impact has already been booked;
// their status may only be changed through the dedicated restore endpoints.
const TERMINAL_STATUSES = ['Sold', 'Dead', 'Slaughtered'];

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

  // Attention-needed filter: animals on the farm for >= N days (by createdAt).
  if (query.minDaysSinceAdded != null) {
    const days = Number(query.minDaysSinceAdded);
    if (Number.isFinite(days) && days >= 0) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      filter.createdAt = { $lte: cutoff };
    }
  }

  // Search. Escape regex metacharacters so user input can't inject a
  // catastrophic-backtracking pattern (ReDoS) or alter the query semantics
  // (audit M-12/26). Length is already capped at 100 by Joi.
  if (query.search) {
    const escaped = String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { tagId: { $regex: escaped, $options: 'i' } },
      { name: { $regex: escaped, $options: 'i' } },
      { electronicId: { $regex: escaped, $options: 'i' } }
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

  const totalPurchaseCost = animalCosts.purchaseCost(animalData);

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

  for (const animalData of animalsData) {
    if (animalData.tagId && existingTagSet.has(animalData.tagId)) {
      results.failed.push({ data: animalData, error: `Tag ID ${animalData.tagId} already exists` });
      continue;
    }
    toInsert.push({ ...animalData, createdBy: userId });
  }

  if (toInsert.length === 0) {
    return results;
  }

  // Snapshot the pre-insert (duplicate-tagId) failures so we can rebuild
  // results.failed idempotently on each transaction attempt — session
  // .withTransaction may re-run this callback on a transient error, and the
  // old code push()'d insert failures onto the shared array each time,
  // duplicating them (audit M-1).
  const preInsertFailures = [...results.failed];

  // Insert + capital deduction inside a transaction so the aggregated capital
  // line matches only the animals that were actually persisted.
  // A4 fix: re-derive totalInvestment from `inserted`, not from `toInsert`.
  await withTransaction(async (session) => {
    let inserted = [];
    const insertFailures = [];
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
        insertFailures.push({ data: failedDoc, error: we.errmsg || we.message || 'Insert failed' });
      }
    }
    // Idempotent assignment (not push) so a retry doesn't accumulate duplicates.
    results.failed = [...preInsertFailures, ...insertFailures];
    results.success = inserted;

    // Derive the capital deduction from the actually-persisted animals only.
    // Total = animal purchase price + purchasing expenses (transport/mandi/fuel/
    // food/hotel). Expenses are already split per-animal by the caller, so we
    // simply sum the stored fields — matching the single-create path which also
    // deducts purchasePrice + expenses.
    const insertedAnimalCost = inserted.reduce(
      (sum, a) => sum + (a.purchasePrice || 0), 0
    );
    const insertedExpenses = inserted.reduce(
      (sum, a) =>
        sum +
        (a.purchaseTransport || 0) +
        (a.purchaseMandiExpenses || 0) +
        (a.purchaseFuel || 0) +
        (a.purchaseFood || 0) +
        (a.purchaseHotel || 0),
      0
    );
    const insertedInvestment = insertedAnimalCost + insertedExpenses;

    if (insertedInvestment > 0) {
      const fmt = (n) => Math.round(n).toLocaleString();
      const description = insertedExpenses > 0
        ? `Bulk import: ${inserted.length} animal(s) — animals Rs ${fmt(insertedAnimalCost)} + purchasing expenses Rs ${fmt(insertedExpenses)} = Rs ${fmt(insertedInvestment)}`
        : `Bulk import: ${inserted.length} animal(s) for total Rs ${fmt(insertedInvestment)}`;
      const result = await Capital.atomicAddTransaction({
        amount: -insertedInvestment,
        type: 'Animal Purchase',
        description,
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

    // Per-entity entries — one insertMany instead of N un-awaited creates
    // (a pen-wide import is 100s–1000s of animals; the old fan-out flooded
    // the Mongo connection pool).
    logActionBatch(results.success.map((a) => ({
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
    })));
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
  'totalSalaryCost',
  // Internal field — never client-settable.
  'soldBatchId'
];
// Statuses that cannot be SET via the generic update path. 'Returned' is
// included because it has no capital workflow (audit M-3); Sold/Dead/Slaughtered
// must go through their dedicated endpoints.
const BLOCKED_STATUSES_VIA_UPDATE = ['Sold', 'Dead', 'Slaughtered', 'Returned'];

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

  // H-7: block changing status when the animal is in a financially-terminal
  // state. A Sold/Dead/Slaughtered animal may only return to Active through the
  // dedicated restore endpoints, which reverse its booked capital. Allowing it
  // here would silently un-do a terminal state with no capital reversal.
  if (
    sanitized.status &&
    sanitized.status !== beforeDoc.status &&
    TERMINAL_STATUSES.includes(beforeDoc.status)
  ) {
    throw ApiError.badRequest(
      `Cannot change status of a ${beforeDoc.status} animal via update. ` +
      `Use restore-from-sold / restore-from-dead, which reverse the capital impact first.`
    );
  }

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

  const totalPurchaseCost = animalCosts.purchaseCost(snapshot);

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

  // M-9: only animals that occupy pen capacity may be moved. Moving a
  // Sold/Dead/Slaughtered animal is meaningless and would mis-state occupancy.
  if (animal.status !== 'Active' && animal.status !== 'Quarantine') {
    throw ApiError.badRequest(
      `Cannot move ${animal.tagId} — its status is '${animal.status}'. Only Active/Quarantine animals can be moved.`
    );
  }

  // Check pen capacity (best-effort; small check-then-save window remains —
  // capacity is also re-validated on the generic update path).
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
  // C-2: only non-terminal animals may be declared dead. Killing a Sold animal
  // would double-book capital (sale already recorded).
  if (!LIFECYCLE_ELIGIBLE_STATUSES.includes(snapshot.status)) {
    throw ApiError.badRequest(
      `Cannot declare ${snapshot.tagId} dead — its status is '${snapshot.status}'. ` +
      (snapshot.status === 'Dead'
        ? 'It is already marked dead.'
        : `Only Active/Quarantine animals can be declared dead; restore it to Active first.`)
    );
  }

  const animalTotalCost = animalCosts.totalCost(snapshot);

  const animal = await withTransaction(async (session) => {
    // Atomic transition: only flip from an eligible (non-terminal) state.
    // Prevents two parallel declare-dead requests from each adding the loss twice.
    const updated = await Animal.findOneAndUpdate(
      { _id: id, status: { $in: LIFECYCLE_ELIGIBLE_STATUSES } },
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
      throw ApiError.badRequest('Animal can no longer be declared dead (status changed concurrently).');
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
  // C-1: only non-terminal animals may be sold. Selling a Dead animal would
  // double-book capital (death loss already recorded).
  if (!LIFECYCLE_ELIGIBLE_STATUSES.includes(snapshot.status)) {
    throw ApiError.badRequest(
      `Cannot sell ${snapshot.tagId} — its status is '${snapshot.status}'. ` +
      (snapshot.status === 'Sold'
        ? 'It is already sold.'
        : `Only Active/Quarantine animals can be sold; restore it to Active first.`)
    );
  }

  const totalCost = animalCosts.totalCost(snapshot);
  const sellingPrice = Number(saleData.sellingPrice) || 0;
  const sellingCost = Number(saleData.sellingCost) || 0;
  const profitFromSale = sellingPrice - totalCost - sellingCost;

  const animal = await withTransaction(async (session) => {
    const updated = await Animal.findOneAndUpdate(
      { _id: id, status: { $in: LIFECYCLE_ELIGIBLE_STATUSES } },
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
      throw ApiError.badRequest('Animal can no longer be sold (status changed concurrently).');
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
/**
 * Bulk mark animals as sold.
 *
 * Performance: clients sell entire pens (100s of animals) in one call. The
 * previous implementation did, per animal, an Animal.findOneAndUpdate + a
 * Capital read + a Capital write — ~3 serial round-trips × N inside one
 * transaction, plus N serial $push to the single Capital singleton. At ~250+
 * animals this exceeded Heroku's 30s timeout.
 *
 * Now: resolve all animals in 2 queries, compute everything in memory, then
 * issue exactly ONE Animal.bulkWrite + ONE batched Capital write. ~4 DB ops
 * total regardless of animal count.
 */
const bulkMarkAsSold = async (animalsData, userId) => {
  const results = { success: [], failed: [] };

  // ── Resolve all referenced animals in 2 queries (by _id and by tagId) ──
  const idRefs = [];
  const tagRefs = [];
  for (const item of animalsData) {
    if (item.animalId) idRefs.push(String(item.animalId));
    else if (item.tagId) tagRefs.push(String(item.tagId));
  }

  const [byId, byTag] = await Promise.all([
    idRefs.length
      ? Animal.find({ _id: { $in: idRefs } }).lean()
      : [],
    tagRefs.length
      ? Animal.find({ tagId: { $in: tagRefs } }).lean()
      : []
  ]);
  const animalById = new Map(byId.map(a => [String(a._id), a]));
  const animalByTag = new Map(byTag.map(a => [String(a.tagId), a]));

  // ── Build candidates + bulkWrite ops in memory ────────────────────────
  // Each candidate carries everything needed to book capital and audit, keyed
  // by animal _id so we can reconcile against the set actually flipped.
  const bulkOps = [];
  const candidates = new Map(); // id -> candidate
  // Unique marker for THIS call — lets us identify exactly which animals our
  // bulkWrite flipped, even if a concurrent sale flips some first (audit H-6).
  const batchId = new mongoose.Types.ObjectId();

  for (const saleItem of animalsData) {
    let animal = null;
    if (saleItem.animalId) animal = animalById.get(String(saleItem.animalId));
    else if (saleItem.tagId) animal = animalByTag.get(String(saleItem.tagId));
    else {
      results.failed.push({ ...saleItem, error: 'animalId or tagId required' });
      continue;
    }

    if (!animal) {
      results.failed.push({
        ...saleItem,
        error: `Animal not found: ${saleItem.animalId || saleItem.tagId}`
      });
      continue;
    }
    // C-1: only non-terminal animals may be sold.
    if (!LIFECYCLE_ELIGIBLE_STATUSES.includes(animal.status)) {
      results.failed.push({
        ...saleItem,
        tagId: animal.tagId,
        error: animal.status === 'Sold'
          ? 'Animal is already marked as sold'
          : `Cannot sell animal in status '${animal.status}'`
      });
      continue;
    }

    const sellingPrice = Number(saleItem.sellingPrice) || 0;
    const sellingCost = Number(saleItem.sellingCost) || 0;
    const soldDate = saleItem.soldDate || new Date();
    const totalCost = animalCosts.totalCost(animal);
    const profitFromSale = sellingPrice - totalCost - sellingCost;
    const refId = String(animal._id);

    bulkOps.push({
      updateOne: {
        // Race-safe: only flip an animal still in an eligible source state.
        filter: { _id: animal._id, status: { $in: LIFECYCLE_ELIGIBLE_STATUSES } },
        update: {
          $set: {
            status: 'Sold',
            soldDate,
            soldPrice: sellingPrice,
            soldCost: sellingCost,
            soldBatchId: batchId
          }
        }
      }
    });

    candidates.set(refId, {
      saleItem, animal, sellingPrice, sellingCost, soldDate,
      totalCost, profitFromSale, refId
    });
  }

  if (bulkOps.length === 0) {
    return results;
  }

  const auditMeta = [];

  // ── ONE bulkWrite, then reconcile the ACTUALLY-flipped set, then ONE
  //    batched capital write — all atomic together (audit H-6). ───────────
  await withTransaction(async (session) => {
    await Animal.bulkWrite(
      bulkOps,
      session ? { session, ordered: false } : { ordered: false }
    );

    // Read back exactly the animals this call flipped (stamped with batchId).
    // If a concurrent sale won the race for some, they simply won't carry our
    // marker and are excluded from the capital booking and reported as failed.
    const flipped = await Animal.find({ soldBatchId: batchId })
      .select('_id')
      .session(session || null)
      .lean();
    const flippedIds = new Set(flipped.map(a => String(a._id)));

    const sales = [];
    for (const [refId, c] of candidates) {
      if (!flippedIds.has(refId)) {
        results.failed.push({
          animalId: c.animal._id,
          tagId: c.animal.tagId,
          error: 'Sold concurrently by another request; skipped to avoid double-booking'
        });
        continue;
      }
      sales.push({
        totalCost: c.totalCost,
        sellingPrice: c.sellingPrice,
        sellingCost: c.sellingCost,
        description: `Animal sale (bulk): ${c.animal.tagId || c.animal.name || c.refId}`,
        reference: refId,
        createdBy: userId
      });
      auditMeta.push({
        animalId: c.animal._id,
        tagId: c.animal.tagId,
        name: c.animal.name,
        soldDate: c.soldDate,
        soldPrice: c.sellingPrice,
        soldCost: c.sellingCost,
        totalCost: c.totalCost,
        profit: c.profitFromSale
      });
      results.success.push({
        animalId: c.animal._id,
        tagId: c.animal.tagId,
        name: c.animal.name,
        totalCost: c.totalCost,
        sellingPrice: c.sellingPrice,
        profit: c.profitFromSale
      });
    }

    if (sales.length === 0) return; // nothing actually flipped

    // Book capital for ONLY the animals this call actually flipped (audit H-6).
    await Capital.atomicRecordAnimalSaleBatch(sales, session);
  });

  // One summary audit entry (per-entity fan-out of 100s of un-awaited writes
  // would flood the connection pool — the summary carries the detail).
  logAction({
    userId,
    action: 'Animal Bulk Marked as Sold',
    entityType: 'Animal',
    entityId: auditMeta[0]?.animalId,
    metadata: {
      bulkOperation: true,
      count: auditMeta.length,
      failedCount: results.failed.length,
      animals: auditMeta
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
  const recordedLoss = animalCosts.totalCost(animal);

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

  const totalCost = animalCosts.totalCost(animal);
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
