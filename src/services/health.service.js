const {
  Vaccination,
  Treatment,
  Deworming,
  WeightRecord,
  TemperatureRecord,
  BcsRecord,
  HoofRecord,
  ShearingRecord,
  Animal,
  Stock
} = require('../models');
const {
  ApiError,
  getPaginationOptions,
  getSortOptions,
  getPaginationMeta,
  logAction,
  logActionBatch,
  withTransaction,
  diffFields
} = require('../utils');

// ============ VACCINATION SERVICES ============

const getVaccinations = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  const filter = {};
  if (query.pen) filter.pen = query.pen;
  if (query.animal) filter.animal = query.animal;
  
  if (query.startDate || query.endDate) {
    filter.date = {};
    if (query.startDate) filter.date.$gte = new Date(query.startDate);
    if (query.endDate) filter.date.$lte = new Date(query.endDate);
  }

  const [vaccinations, total] = await Promise.all([
    Vaccination.find(filter)
      .populate('pen', 'name')
      .populate('animal', 'tagId name')
      .populate('technician', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Vaccination.countDocuments(filter)
  ]);

  return {
    data: vaccinations,
    meta: getPaginationMeta(total, page, limit)
  };
};

const createVaccination = async (data, userId) => {
  // Calculate animal count based on scope
  if (data.scope === 'All Animals') {
    data.animalCount = await Animal.countDocuments({ status: 'Active' });
    data.animals = await Animal.find({ status: 'Active' }).select('_id');
  } else if (data.scope === 'Shed' && data.pen) {
    data.animalCount = await Animal.countDocuments({ pen: data.pen, status: 'Active' });
    data.animals = await Animal.find({ pen: data.pen, status: 'Active' }).select('_id');
  } else if (data.scope === 'Individual Animal' && data.animal) {
    data.animalCount = 1;
    data.animals = [data.animal];
  }

  const vaccination = await Vaccination.create({
    ...data,
    createdBy: userId
  });

  // Create audit log
  logAction({
    userId,
    action: 'Vaccination Record Created',
    entityType: 'Vaccination',
    entityId: vaccination._id,
    metadata: {
      scope: data.scope,
      disease: data.disease,
      vaccineUsed: data.vaccineUsed,
      animalCount: data.animalCount,
      date: data.date
    }
  });

  return vaccination.populate(['pen', 'animal', 'technician']);
};

const deleteVaccination = async (id, userId) => {
  const vaccination = await Vaccination.findByIdAndDelete(id);
  if (!vaccination) throw ApiError.notFound('Vaccination record not found');

  // Restore stock quantities
  if (vaccination.medicines && vaccination.medicines.length > 0) {
    for (const med of vaccination.medicines) {
      const stock = await Stock.findById(med.medicine);
      if (stock) {
        stock.currentQty += med.quantity;
        await stock.save();
      }
    }
  }

  // Reverse vaccination cost from animals
  if (vaccination.totalCost > 0) {
    if ((vaccination.scope === 'Individual' || vaccination.scope === 'Individual Animal') && vaccination.animal) {
      // Individual animal - reverse full cost
      await Animal.findByIdAndUpdate(vaccination.animal, {
        $inc: { totalVaccinationCost: -vaccination.totalCost }
      });
    } else if ((vaccination.scope === 'Pen' || vaccination.scope === 'Shed') && vaccination.pen) {
      // Pen/Shed scope - reverse distributed cost
      const activeAnimals = await Animal.find({ pen: vaccination.pen, status: 'Active' });
      if (activeAnimals.length > 0) {
        const perAnimalBase = Math.floor((vaccination.totalCost * 100 / activeAnimals.length)) / 100;
        const remainder = Number((vaccination.totalCost - perAnimalBase * activeAnimals.length).toFixed(2));
        // Reverse base from all
        await Animal.updateMany(
          { pen: vaccination.pen, status: 'Active' },
          { $inc: { totalVaccinationCost: -perAnimalBase } }
        );
        // Reverse remainder from first animal
        if (remainder > 0 && activeAnimals.length > 0) {
          await Animal.findByIdAndUpdate(activeAnimals[0]._id, {
            $inc: { totalVaccinationCost: -remainder }
          });
        }
      }
    } else if (vaccination.scope === 'Multiple' && vaccination.animals && vaccination.animals.length > 0) {
      // Multiple animals - reverse distributed cost
      const perAnimalBase = Math.floor((vaccination.totalCost * 100 / vaccination.animals.length)) / 100;
      const remainder = Number((vaccination.totalCost - perAnimalBase * vaccination.animals.length).toFixed(2));
      // Reverse base from all
      await Animal.updateMany(
        { _id: { $in: vaccination.animals }, status: 'Active' },
        { $inc: { totalVaccinationCost: -perAnimalBase } }
      );
      // Reverse remainder from first animal
      if (remainder > 0 && vaccination.animals.length > 0) {
        await Animal.findByIdAndUpdate(vaccination.animals[0], {
          $inc: { totalVaccinationCost: -remainder }
        });
      }
    } else if (vaccination.scope === 'All Animals') {
      // All animals scope - reverse distributed cost
      const activeAnimalCount = await Animal.countDocuments({ status: 'Active' });
      if (activeAnimalCount > 0) {
        const perAnimalBase = Math.floor((vaccination.totalCost * 100 / activeAnimalCount)) / 100;
        const remainder = Number((vaccination.totalCost - perAnimalBase * activeAnimalCount).toFixed(2));
        // Reverse base from all
        await Animal.updateMany(
          { status: 'Active' },
          { $inc: { totalVaccinationCost: -perAnimalBase } }
        );
        // Reverse remainder from first animal
        if (remainder > 0) {
          const firstAnimal = await Animal.findOne({ status: 'Active' });
          if (firstAnimal) {
            await firstAnimal.updateOne({ $inc: { totalVaccinationCost: -remainder } });
          }
        }
      }
    }
  }

  // Create audit log
  logAction({
    userId,
    action: 'Vaccination Record Deleted',
    entityType: 'Vaccination',
    entityId: vaccination._id,
    metadata: {
      disease: vaccination.disease,
      vaccineUsed: vaccination.vaccineUsed,
      animalCount: vaccination.animalCount
    }
  });

  return vaccination;
};

// ============ TREATMENT SERVICES ============

const getTreatments = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  const filter = {};
  if (query.animal) filter.animal = query.animal;
  if (query.cureStatus && query.cureStatus !== 'Both') {
    filter.cureStatus = query.cureStatus;
  }
  
  if (query.startDate || query.endDate) {
    filter.date = {};
    if (query.startDate) filter.date.$gte = new Date(query.startDate);
    if (query.endDate) filter.date.$lte = new Date(query.endDate);
  }

  const [treatments, total] = await Promise.all([
    Treatment.find(filter)
      .populate('animal', 'tagId name')
      .populate('veterinarian', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Treatment.countDocuments(filter)
  ]);

  return {
    data: treatments,
    meta: getPaginationMeta(total, page, limit)
  };
};

const createTreatment = async (data, userId) => {
  const animal = await Animal.findById(data.animal);
  if (!animal) throw ApiError.notFound('Animal not found');

  data.animalTagId = animal.tagId;
  data.animalName = animal.name;

  // Atomic: stock deductions + treatment create + animal cost increment.
  // H2 fix: if any deduction fails, the treatment is NOT persisted (no orphan).
  const treatment = await withTransaction(async (session) => {
    // Deduct stocks first via atomic conditional updates
    if (data.medicines && data.medicines.length > 0) {
      for (const med of data.medicines) {
        const updated = await Stock.findOneAndUpdate(
          { _id: med.medicine, currentQty: { $gte: med.quantity } },
          { $inc: { currentQty: -med.quantity } },
          { new: true, ...(session ? { session } : {}) }
        );
        if (!updated) {
          const probe = await Stock.findById(med.medicine, 'productName currentQty unit')
            .session(session || null).lean();
          throw ApiError.badRequest(
            `Insufficient stock for ${probe?.productName || med.medicine}. ` +
            `Available: ${probe?.currentQty ?? 0} ${probe?.unit || ''}, Required: ${med.quantity}`
          );
        }
      }
    }

    const [created] = await Treatment.create(
      [{ ...data, createdBy: userId }],
      session ? { session } : {}
    );

    if (created.totalAmount > 0) {
      await Animal.findByIdAndUpdate(
        created.animal,
        { $inc: { totalHealthCost: created.totalAmount } },
        session ? { session } : {}
      );
    }

    return created;
  });

  logAction({
    userId,
    action: 'Treatment Record Created',
    entityType: 'Treatment',
    entityId: treatment._id,
    metadata: {
      animalTagId: animal.tagId,
      animalName: animal.name,
      diagnosis: data.diagnosis,
      treatmentType: data.treatmentType,
      date: data.date
    }
  });

  return treatment.populate(['animal', 'veterinarian']);
};

const updateTreatment = async (id, data, userId) => {
  const beforeDoc = await Treatment.findById(id).lean();
  if (!beforeDoc) throw ApiError.notFound('Treatment not found');

  const treatment = await Treatment.findByIdAndUpdate(
    id,
    { $set: data },
    { new: true, runValidators: true }
  ).populate(['animal', 'veterinarian']);

  const diff = diffFields(
    beforeDoc,
    treatment.toObject ? treatment.toObject() : treatment,
    Object.keys(data)
  );

  logAction({
    userId,
    action: 'Treatment Record Updated',
    entityType: 'Treatment',
    entityId: treatment._id,
    metadata: {
      animalTagId: treatment.animalTagId,
      diagnosis: treatment.diagnosis,
      cureStatus: treatment.cureStatus,
      diff
    }
  });

  return treatment;
};

const deleteTreatment = async (id, userId) => {
  const treatment = await Treatment.findById(id);
  if (!treatment) throw ApiError.notFound('Treatment record not found');

  await withTransaction(async (session) => {
    // Restore stock quantities atomically
    if (treatment.medicines && treatment.medicines.length > 0) {
      for (const med of treatment.medicines) {
        await Stock.findByIdAndUpdate(
          med.medicine,
          { $inc: { currentQty: med.quantity } },
          session ? { session } : {}
        );
      }
    }

    // Reverse animal health cost
    if (treatment.totalAmount > 0) {
      await Animal.findByIdAndUpdate(
        treatment.animal,
        { $inc: { totalHealthCost: -treatment.totalAmount } },
        session ? { session } : {}
      );
    }

    await Treatment.findByIdAndDelete(id, session ? { session } : {});
  });

  logAction({
    userId,
    action: 'Treatment Record Deleted',
    entityType: 'Treatment',
    entityId: treatment._id,
    metadata: {
      animalTagId: treatment.animalTagId,
      diagnosis: treatment.diagnosis,
      cureStatus: treatment.cureStatus
    }
  });

  return treatment;
};

// ============ DEWORMING SERVICES ============

const getDewormings = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  const filter = {};
  if (query.pen) filter.pen = query.pen;
  if (query.animal) filter.animal = query.animal;
  
  if (query.startDate || query.endDate) {
    filter.date = {};
    if (query.startDate) filter.date.$gte = new Date(query.startDate);
    if (query.endDate) filter.date.$lte = new Date(query.endDate);
  }

  const [dewormings, total] = await Promise.all([
    Deworming.find(filter)
      .populate('pen', 'name')
      .populate('animal', 'tagId name')
      .populate('technician', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Deworming.countDocuments(filter)
  ]);

  return {
    data: dewormings,
    meta: getPaginationMeta(total, page, limit)
  };
};

const createDeworming = async (data, userId) => {
  // Calculate animal count based on scope (snapshot outside txn).
  // NOTE: scope values are 'Shed' / 'Individual Animal' (see DEWORMING_SCOPES
  // in constants + the model enum + the frontend). An earlier version compared
  // against 'Pen' / 'Individual', which never matched — so animalCount stayed
  // at its default 0 AND the per-animal cost distribution was skipped.
  if (data.scope === 'Shed' && data.pen) {
    data.animalCount = await Animal.countDocuments({ pen: data.pen, status: 'Active' });
  } else if (data.scope === 'Individual Animal' && data.animal) {
    data.animalCount = 1;
    const animal = await Animal.findById(data.animal);
    if (animal) data.animalTagId = animal.tagId;
  }

  // Atomic: stock deductions + deworming create + animal cost increment.
  const deworming = await withTransaction(async (session) => {
    if (data.medicines && data.medicines.length > 0) {
      for (const med of data.medicines) {
        const updated = await Stock.findOneAndUpdate(
          { _id: med.medicine, currentQty: { $gte: med.quantity } },
          { $inc: { currentQty: -med.quantity } },
          { new: true, ...(session ? { session } : {}) }
        );
        if (!updated) {
          const probe = await Stock.findById(med.medicine, 'productName currentQty unit')
            .session(session || null).lean();
          throw ApiError.badRequest(
            `Insufficient stock for ${probe?.productName || med.medicine}. ` +
            `Available: ${probe?.currentQty ?? 0} ${probe?.unit || ''}, Required: ${med.quantity}`
          );
        }
      }
    }

    const [created] = await Deworming.create(
      [{ ...data, createdBy: userId }],
      session ? { session } : {}
    );

    if (created.totalCost > 0) {
      if (created.scope === 'Individual Animal' && created.animal) {
        await Animal.findByIdAndUpdate(
          created.animal,
          { $inc: { totalDewormingCost: created.totalCost } },
          session ? { session } : {}
        );
      } else if (created.scope === 'Shed' && created.pen) {
        const count = await Animal.countDocuments({ pen: created.pen, status: 'Active' })
          .session(session || null);
        if (count > 0) {
          const perAnimal = created.totalCost / count;
          await Animal.updateMany(
            { pen: created.pen, status: 'Active' },
            { $inc: { totalDewormingCost: perAnimal } },
            session ? { session } : {}
          );
        }
      }
    }

    return created;
  });

  logAction({
    userId,
    action: 'Deworming Record Created',
    entityType: 'Deworming',
    entityId: deworming._id,
    metadata: {
      scope: data.scope,
      dewormingType: data.dewormingType,
      animalCount: data.animalCount,
      date: data.date
    }
  });

  return deworming.populate(['pen', 'animal', 'technician']);
};

const deleteDeworming = async (id, userId) => {
  const deworming = await Deworming.findById(id);
  if (!deworming) throw ApiError.notFound('Deworming record not found');

  await withTransaction(async (session) => {
    if (deworming.medicines && deworming.medicines.length > 0) {
      for (const med of deworming.medicines) {
        await Stock.findByIdAndUpdate(
          med.medicine,
          { $inc: { currentQty: med.quantity } },
          session ? { session } : {}
        );
      }
    }

    if (deworming.totalCost > 0) {
      if (deworming.scope === 'Individual Animal' && deworming.animal) {
        await Animal.findByIdAndUpdate(
          deworming.animal,
          { $inc: { totalDewormingCost: -deworming.totalCost } },
          session ? { session } : {}
        );
      } else if (deworming.scope === 'Shed' && deworming.pen) {
        const count = await Animal.countDocuments({ pen: deworming.pen, status: 'Active' })
          .session(session || null);
        if (count > 0) {
          const perAnimal = deworming.totalCost / count;
          await Animal.updateMany(
            { pen: deworming.pen, status: 'Active' },
            { $inc: { totalDewormingCost: -perAnimal } },
            session ? { session } : {}
          );
        }
      }
    }

    await Deworming.findByIdAndDelete(id, session ? { session } : {});
  });

  logAction({
    userId,
    action: 'Deworming Record Deleted',
    entityType: 'Deworming',
    entityId: deworming._id,
    metadata: {
      scope: deworming.scope,
      dewormingType: deworming.dewormingType,
      animalCount: deworming.animalCount
    }
  });

  return deworming;
};

// ============ WEIGHT RECORD SERVICES ============

const getWeightRecords = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  const filter = {};
  if (query.animal) filter.animal = query.animal;
  
  if (query.startDate || query.endDate) {
    filter.date = {};
    if (query.startDate) filter.date.$gte = new Date(query.startDate);
    if (query.endDate) filter.date.$lte = new Date(query.endDate);
  }

  const [records, total] = await Promise.all([
    WeightRecord.find(filter)
      .populate('animal', 'tagId name')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    WeightRecord.countDocuments(filter)
  ]);

  return {
    data: records,
    meta: getPaginationMeta(total, page, limit)
  };
};

const createWeightRecord = async (data, userId) => {
  const animal = await Animal.findById(data.animal);
  if (!animal) throw ApiError.notFound('Animal not found');

  data.animalTagId = animal.tagId;
  data.animalName = animal.name;

  const record = await WeightRecord.create({
    ...data,
    recordedBy: userId,
    createdBy: userId
  });

  // Create audit log
  logAction({
    userId,
    action: 'Weight Record Created',
    entityType: 'WeightRecord',
    entityId: record._id,
    metadata: {
      animalTagId: animal.tagId,
      animalName: animal.name,
      weight: data.weight,
      date: data.date
    }
  });

  return record.populate('animal');
};

// ============ BULK WEIGHT RECORD SERVICE ============

const bulkCreateWeightRecords = async (records, userId) => {
  const mongoose = require('mongoose');
  const animalIds = [...new Set(records.map(r => r.animal))];

  // Fetch animals and latest weight per animal in parallel — just 2 DB queries total
  const [animals, latestWeights] = await Promise.all([
    Animal.find({ _id: { $in: animalIds } }).lean(),
    WeightRecord.aggregate([
      { $match: { animal: { $in: animalIds.map(id => new mongoose.Types.ObjectId(id)) } } },
      { $sort: { date: -1 } },
      { $group: { _id: '$animal', weight: { $first: '$weight' }, date: { $first: '$date' } } }
    ])
  ]);

  const animalMap = new Map(animals.map(a => [String(a._id), a]));
  const latestWeightMap = new Map(latestWeights.map(r => [String(r._id), r.weight]));

  const docs = [];
  const errors = [];

  // Track latest-per-animal in this batch so we can update Animal.weight after
  // insertMany (replacing the side effect that the single-create pre-save hook
  // provides — bypassed by insertMany).
  const latestPerAnimal = new Map(); // animalId → { weight, date }

  for (let i = 0; i < records.length; i++) {
    const data = records[i];
    const animal = animalMap.get(String(data.animal));
    if (!animal) {
      errors.push({ index: i, animal: data.animal, message: 'Animal not found' });
      continue;
    }

    const prevWeight = latestWeightMap.get(String(data.animal)) ?? animal.weight ?? 0;
    const weightChange = data.weight - prevWeight;
    const percentageChange = prevWeight > 0
      ? Number(((weightChange / prevWeight) * 100).toFixed(2))
      : 0;
    const date = data.date ? new Date(data.date) : new Date();

    docs.push({
      animal: data.animal,
      animalTagId: animal.tagId,
      animalName: animal.name,
      date,
      weight: data.weight,
      previousWeight: prevWeight,
      weightChange: Number(weightChange.toFixed(2)),
      percentageChange,
      notes: data.notes || undefined,
      recordedBy: userId,
      createdBy: userId
    });

    const key = String(data.animal);
    const existing = latestPerAnimal.get(key);
    if (!existing || date >= existing.date) {
      latestPerAnimal.set(key, { weight: data.weight, date });
    }
  }

  let inserted = [];
  if (docs.length > 0) {
    await withTransaction(async (session) => {
      inserted = await WeightRecord.insertMany(docs, {
        ordered: false,
        ...(session ? { session } : {})
      });

      // H10 fix: replicate the per-animal weight update that insertMany skips.
      // Perf: a per-animal findByIdAndUpdate loop here was N serial round-trips
      // inside the transaction — for a pen-wide bulk (100s of animals) that
      // risked the Heroku 30s timeout. Collapse to a single bulkWrite.
      if (latestPerAnimal.size > 0) {
        const animalOps = [];
        for (const [animalId, { weight, date }] of latestPerAnimal.entries()) {
          animalOps.push({
            updateOne: {
              filter: { _id: animalId },
              update: { $set: { weight, weightDate: date } }
            }
          });
        }
        await Animal.bulkWrite(
          animalOps,
          session ? { session, ordered: false } : { ordered: false }
        );
      }
    });
  }

  if (inserted.length > 0) {
    // Summary + per-entity audit entries (AL4).
    logAction({
      userId,
      action: 'Bulk Weight Records Summary',
      entityType: 'WeightRecord',
      entityId: inserted[0]._id,
      metadata: {
        totalCreated: inserted.length,
        totalFailed: errors.length,
        totalRequested: records.length,
        animalsUpdated: latestPerAnimal.size
      }
    });
    logActionBatch(inserted.map((rec) => ({
      userId,
      action: 'Weight Record Created',
      entityType: 'WeightRecord',
      entityId: rec._id,
      metadata: {
        animalTagId: rec.animalTagId,
        weight: rec.weight,
        weightChange: rec.weightChange,
        bulk: true
      }
    })));
  }

  return { created: inserted, errors };
};

// ============ TEMPERATURE RECORD SERVICES ============

const getTemperatureRecords = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  const filter = {};
  if (query.animal) filter.animal = query.animal;

  if (query.startDate || query.endDate) {
    filter.date = {};
    if (query.startDate) filter.date.$gte = new Date(query.startDate);
    if (query.endDate) filter.date.$lte = new Date(query.endDate);
  }

  const [records, total] = await Promise.all([
    TemperatureRecord.find(filter)
      .populate('animal', 'tagId name')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    TemperatureRecord.countDocuments(filter)
  ]);

  return {
    data: records,
    meta: getPaginationMeta(total, page, limit)
  };
};

const createTemperatureRecord = async (data, userId) => {
  const animal = await Animal.findById(data.animal);
  if (!animal) throw ApiError.notFound('Animal not found');

  data.animalTagId = animal.tagId;
  data.animalName = animal.name;

  const record = await TemperatureRecord.create({
    ...data,
    recordedBy: userId,
    createdBy: userId
  });

  logAction({
    userId,
    action: 'Temperature Record Created',
    entityType: 'TemperatureRecord',
    entityId: record._id,
    metadata: {
      animalTagId: animal.tagId,
      animalName: animal.name,
      temperature: data.temperature,
      date: data.date
    }
  });

  return record.populate('animal');
};

// ============ BULK TEMPERATURE RECORD SERVICE ============

const bulkCreateTemperatureRecords = async (records, userId) => {
  const mongoose = require('mongoose');
  const animalIds = [...new Set(records.map(r => r.animal))];

  const [animals, latestTemps] = await Promise.all([
    Animal.find({ _id: { $in: animalIds } }).lean(),
    TemperatureRecord.aggregate([
      { $match: { animal: { $in: animalIds.map(id => new mongoose.Types.ObjectId(id)) } } },
      { $sort: { date: -1 } },
      { $group: { _id: '$animal', temperature: { $first: '$temperature' } } }
    ])
  ]);

  const animalMap = new Map(animals.map(a => [String(a._id), a]));
  const latestTempMap = new Map(latestTemps.map(r => [String(r._id), r.temperature]));

  const docs = [];
  const errors = [];

  for (let i = 0; i < records.length; i++) {
    const data = records[i];
    const animal = animalMap.get(String(data.animal));
    if (!animal) {
      errors.push({ index: i, animal: data.animal, message: 'Animal not found' });
      continue;
    }

    const prevTemp = latestTempMap.get(String(data.animal)) ?? 0;
    const tempChange = prevTemp > 0
      ? Number((data.temperature - prevTemp).toFixed(2))
      : 0;

    docs.push({
      animal: data.animal,
      animalTagId: animal.tagId,
      animalName: animal.name,
      date: data.date ? new Date(data.date) : new Date(),
      temperature: data.temperature,
      previousTemperature: prevTemp,
      temperatureChange: tempChange,
      notes: data.notes || undefined,
      recordedBy: userId,
      createdBy: userId
    });
  }

  const inserted = docs.length > 0 ? await TemperatureRecord.insertMany(docs, { ordered: false }) : [];

  if (inserted.length > 0) {
    logAction({
      userId,
      action: 'Bulk Temperature Records Summary',
      entityType: 'TemperatureRecord',
      entityId: inserted[0]._id,
      metadata: {
        totalCreated: inserted.length,
        totalFailed: errors.length,
        totalRequested: records.length
      }
    });
    logActionBatch(inserted.map((rec) => ({
      userId,
      action: 'Temperature Record Created',
      entityType: 'TemperatureRecord',
      entityId: rec._id,
      metadata: {
        animalTagId: rec.animalTagId,
        temperature: rec.temperature,
        bulk: true
      }
    })));
  }

  return { created: inserted, errors };
};

// ============ BCS RECORD SERVICES ============

const getBcsRecords = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  const filter = {};
  if (query.animal) filter.animal = query.animal;
  
  if (query.startDate || query.endDate) {
    filter.date = {};
    if (query.startDate) filter.date.$gte = new Date(query.startDate);
    if (query.endDate) filter.date.$lte = new Date(query.endDate);
  }

  const [records, total] = await Promise.all([
    BcsRecord.find(filter)
      .populate('animal', 'tagId name')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    BcsRecord.countDocuments(filter)
  ]);

  return {
    data: records,
    meta: getPaginationMeta(total, page, limit)
  };
};

const createBcsRecord = async (data, userId) => {
  const animal = await Animal.findById(data.animal);
  if (!animal) throw ApiError.notFound('Animal not found');

  data.animalTagId = animal.tagId;
  data.animalName = animal.name;

  const record = await BcsRecord.create({
    ...data,
    assessedBy: userId,
    createdBy: userId
  });

  // Create audit log
  logAction({
    userId,
    action: 'BCS Record Created',
    entityType: 'BCSRecord',
    entityId: record._id,
    metadata: {
      animalTagId: animal.tagId,
      animalName: animal.name,
      bcsScore: data.bcsScore,
      date: data.date
    }
  });

  return record.populate('animal');
};

// ============ HOOF RECORD SERVICES ============

const getHoofRecords = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  const filter = {};
  if (query.animal) filter.animal = query.animal;
  
  if (query.startDate || query.endDate) {
    filter.date = {};
    if (query.startDate) filter.date.$gte = new Date(query.startDate);
    if (query.endDate) filter.date.$lte = new Date(query.endDate);
  }

  const [records, total] = await Promise.all([
    HoofRecord.find(filter)
      .populate('animal', 'tagId name')
      .populate('technician', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    HoofRecord.countDocuments(filter)
  ]);

  return {
    data: records,
    meta: getPaginationMeta(total, page, limit)
  };
};

const createHoofRecord = async (data, userId) => {
  const animal = await Animal.findById(data.animal);
  if (!animal) throw ApiError.notFound('Animal not found');

  data.animalTagId = animal.tagId;
  data.animalName = animal.name;

  const record = await HoofRecord.create({
    ...data,
    createdBy: userId
  });

  // Create audit log
  logAction({
    userId,
    action: 'Hoof Record Created',
    entityType: 'HoofRecord',
    entityId: record._id,
    metadata: {
      animalTagId: animal.tagId,
      animalName: animal.name,
      diagnosis: data.diagnosis,
      date: data.date
    }
  });

  return record.populate(['animal', 'technician']);
};

const bulkCreateHoofRecords = async (data, userId) => {
  const mongoose = require('mongoose');
  const { animals: animalIds, ...sharedData } = data;

  const animals = await Animal.find({ _id: { $in: animalIds } }).lean();
  const animalMap = new Map(animals.map(a => [String(a._id), a]));

  const docs = [];
  const errors = [];
  const insertedAnimalIds = [];

  for (let i = 0; i < animalIds.length; i++) {
    const animal = animalMap.get(String(animalIds[i]));
    if (!animal) {
      errors.push({ index: i, animal: animalIds[i], message: 'Animal not found' });
      continue;
    }
    docs.push({
      ...sharedData,
      animal: new mongoose.Types.ObjectId(animalIds[i]),
      animalTagId: animal.tagId,
      animalName: animal.name,
      date: sharedData.date ? new Date(sharedData.date) : new Date(),
      createdBy: userId
    });
    insertedAnimalIds.push(animalIds[i]);
  }

  let inserted = [];
  const cost = Number(sharedData.cost) || 0;
  if (docs.length > 0) {
    await withTransaction(async (session) => {
      inserted = await HoofRecord.insertMany(docs, {
        ordered: false,
        ...(session ? { session } : {})
      });

      // H8 fix: replicate the per-animal totalHealthCost increment that
      // insertMany skipped (single-create pre-save hook does this when cost > 0).
      if (cost > 0 && insertedAnimalIds.length > 0) {
        await Animal.updateMany(
          { _id: { $in: insertedAnimalIds } },
          { $inc: { totalHealthCost: cost } },
          session ? { session } : {}
        );
      }
    });
  }

  if (inserted.length > 0) {
    logAction({
      userId,
      action: 'Bulk Hoof Records Summary',
      entityType: 'HoofRecord',
      entityId: inserted[0]._id,
      metadata: {
        totalCreated: inserted.length,
        totalFailed: errors.length,
        totalRequested: animalIds.length,
        diagnosis: sharedData.diagnosis,
        costPerAnimal: cost,
        totalAnimalsCharged: cost > 0 ? insertedAnimalIds.length : 0
      }
    });
    logActionBatch(inserted.map((rec) => ({
      userId,
      action: 'Hoof Record Created',
      entityType: 'HoofRecord',
      entityId: rec._id,
      metadata: {
        animalTagId: rec.animalTagId,
        diagnosis: rec.diagnosis,
        cost: rec.cost,
        bulk: true
      }
    })));
  }

  return { created: inserted, errors };
};

const updateHoofRecord = async (id, data, userId) => {
  const beforeDoc = await HoofRecord.findById(id).lean();
  if (!beforeDoc) throw ApiError.notFound('Hoof record not found');

  const record = await HoofRecord.findByIdAndUpdate(
    id,
    { $set: data },
    { new: true, runValidators: true }
  ).populate(['animal', 'technician']);

  const diff = diffFields(
    beforeDoc,
    record.toObject ? record.toObject() : record,
    Object.keys(data)
  );

  logAction({
    userId,
    action: 'Hoof Record Updated',
    entityType: 'HoofRecord',
    entityId: record._id,
    metadata: {
      animalTagId: record.animalTagId,
      diagnosis: record.diagnosis,
      diff
    }
  });

  return record;
};

const deleteHoofRecord = async (id, userId) => {
  const record = await HoofRecord.findByIdAndDelete(id);
  if (!record) throw ApiError.notFound('Hoof record not found');
  
  // Create audit log
  logAction({
    userId,
    action: 'Hoof Record Deleted',
    entityType: 'HoofRecord',
    entityId: record._id,
    metadata: {
      animalTagId: record.animalTagId,
      diagnosis: record.diagnosis
    }
  });
  
  return record;
};

// ============ SHEARING RECORD SERVICES ============

const getShearingRecords = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  const filter = {};
  if (query.animal) filter.animal = query.animal;
  
  if (query.startDate || query.endDate) {
    filter.date = {};
    if (query.startDate) filter.date.$gte = new Date(query.startDate);
    if (query.endDate) filter.date.$lte = new Date(query.endDate);
  }

  const [records, total] = await Promise.all([
    ShearingRecord.find(filter)
      .populate('animal', 'tagId name')
      .populate('technician', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    ShearingRecord.countDocuments(filter)
  ]);

  return {
    data: records,
    meta: getPaginationMeta(total, page, limit)
  };
};

const createShearingRecord = async (data, userId) => {
  const animal = await Animal.findById(data.animal);
  if (!animal) throw ApiError.notFound('Animal not found');

  data.animalTagId = animal.tagId;
  data.animalName = animal.name;

  const record = await ShearingRecord.create({
    ...data,
    createdBy: userId
  });

  logAction({
    userId,
    action: 'Shearing Record Created',
    entityType: 'ShearingRecord',
    entityId: record._id,
    metadata: {
      animalTagId: animal.tagId,
      animalName: animal.name,
      shearingType: data.shearingType,
      date: data.date
    }
  });

  return record.populate(['animal', 'technician']);
};

const bulkCreateShearingRecords = async (data, userId) => {
  const mongoose = require('mongoose');
  const { animals: animalIds, ...sharedData } = data;

  const animals = await Animal.find({ _id: { $in: animalIds } }).lean();
  const animalMap = new Map(animals.map(a => [String(a._id), a]));

  const docs = [];
  const errors = [];
  const insertedAnimalIds = [];

  for (let i = 0; i < animalIds.length; i++) {
    const animal = animalMap.get(String(animalIds[i]));
    if (!animal) {
      errors.push({ index: i, animal: animalIds[i], message: 'Animal not found' });
      continue;
    }
    docs.push({
      ...sharedData,
      animal: new mongoose.Types.ObjectId(animalIds[i]),
      animalTagId: animal.tagId,
      animalName: animal.name,
      date: sharedData.date ? new Date(sharedData.date) : new Date(),
      createdBy: userId
    });
    insertedAnimalIds.push(animalIds[i]);
  }

  let inserted = [];
  const cost = Number(sharedData.cost) || 0;
  if (docs.length > 0) {
    await withTransaction(async (session) => {
      inserted = await ShearingRecord.insertMany(docs, {
        ordered: false,
        ...(session ? { session } : {})
      });

      // H8 fix: replicate single-create's $inc totalHealthCost side effect.
      if (cost > 0 && insertedAnimalIds.length > 0) {
        await Animal.updateMany(
          { _id: { $in: insertedAnimalIds } },
          { $inc: { totalHealthCost: cost } },
          session ? { session } : {}
        );
      }
    });
  }

  if (inserted.length > 0) {
    logAction({
      userId,
      action: 'Bulk Shearing Records Summary',
      entityType: 'ShearingRecord',
      entityId: inserted[0]._id,
      metadata: {
        totalCreated: inserted.length,
        totalFailed: errors.length,
        totalRequested: animalIds.length,
        shearingType: sharedData.shearingType,
        costPerAnimal: cost,
        totalAnimalsCharged: cost > 0 ? insertedAnimalIds.length : 0
      }
    });
    logActionBatch(inserted.map((rec) => ({
      userId,
      action: 'Shearing Record Created',
      entityType: 'ShearingRecord',
      entityId: rec._id,
      metadata: {
        animalTagId: rec.animalTagId,
        shearingType: rec.shearingType,
        cost: rec.cost,
        bulk: true
      }
    })));
  }

  return { created: inserted, errors };
};

const updateShearingRecord = async (id, data, userId) => {
  const beforeDoc = await ShearingRecord.findById(id).lean();
  if (!beforeDoc) throw ApiError.notFound('Shearing record not found');

  const record = await ShearingRecord.findByIdAndUpdate(
    id,
    { $set: data },
    { new: true, runValidators: true }
  ).populate(['animal', 'technician']);

  const diff = diffFields(
    beforeDoc,
    record.toObject ? record.toObject() : record,
    Object.keys(data)
  );

  logAction({
    userId,
    action: 'Shearing Record Updated',
    entityType: 'ShearingRecord',
    entityId: record._id,
    metadata: {
      animalTagId: record.animalTagId,
      shearingType: record.shearingType,
      diff
    }
  });
  
  return record;
};

const deleteShearingRecord = async (id, userId) => {
  const record = await ShearingRecord.findByIdAndDelete(id);
  if (!record) throw ApiError.notFound('Shearing record not found');
  
  logAction({
    userId,
    action: 'Shearing Record Deleted',
    entityType: 'ShearingRecord',
    entityId: record._id,
    metadata: {
      animalTagId: record.animalTagId,
      shearingType: record.shearingType
    }
  });
  
  return record;
};

// ============ CURE TRACKING ============

const getCureTracking = async (query) => {
  const filter = {};
  
  if (query.cureStatus && query.cureStatus !== 'Both') {
    filter.cureStatus = query.cureStatus;
  }
  
  if (query.startDate || query.endDate) {
    filter.date = {};
    if (query.startDate) filter.date.$gte = new Date(query.startDate);
    if (query.endDate) filter.date.$lte = new Date(query.endDate);
  }

  const treatments = await Treatment.find(filter)
    .populate('animal', 'tagId name')
    .populate('veterinarian', 'name')
    .sort({ date: -1 });

  // Get summary statistics
  const stats = await Treatment.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$cureStatus',
        count: { $sum: 1 }
      }
    }
  ]);

  return {
    data: treatments,
    stats
  };
};

module.exports = {
  // Vaccination
  getVaccinations,
  createVaccination,
  deleteVaccination,
  // Treatment
  getTreatments,
  createTreatment,
  updateTreatment,
  deleteTreatment,
  // Deworming
  getDewormings,
  createDeworming,
  deleteDeworming,
  // Weight Records
  getWeightRecords,
  createWeightRecord,
  bulkCreateWeightRecords,
  // Temperature Records
  getTemperatureRecords,
  createTemperatureRecord,
  bulkCreateTemperatureRecords,
  // BCS Records
  getBcsRecords,
  createBcsRecord,
  // Hoof Records
  getHoofRecords,
  createHoofRecord,
  bulkCreateHoofRecords,
  updateHoofRecord,
  deleteHoofRecord,
  // Shearing Records
  getShearingRecords,
  createShearingRecord,
  bulkCreateShearingRecords,
  updateShearingRecord,
  deleteShearingRecord,
  // Cure Tracking
  getCureTracking
};
