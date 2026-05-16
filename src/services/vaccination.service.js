const { Stock, VaccineRecipe, VaccineApplication, Animal, Pen } = require('../models');
const logger = require('../utils/logger');
const {
  ApiError,
  getPaginationOptions,
  getSortOptions,
  getPaginationMeta,
  logAction,
  withTransaction
} = require('../utils');

// ============ VACCINE RECIPE SERVICES ============

const getAllVaccines = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-createdAt');

  const filter = {};
  if (query.disease) filter.disease = { $regex: query.disease, $options: 'i' };
  if (query.isActive !== undefined) filter.isActive = query.isActive;

  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { disease: { $regex: query.search, $options: 'i' } },
      { description: { $regex: query.search, $options: 'i' } }
    ];
  }

  const [vaccines, total] = await Promise.all([
    VaccineRecipe.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    VaccineRecipe.countDocuments(filter)
  ]);

  return {
    data: vaccines,
    meta: getPaginationMeta(total, page, limit)
  };
};

const getVaccineById = async (id) => {
  const vaccine = await VaccineRecipe.findById(id);

  if (!vaccine) {
    throw ApiError.notFound('Vaccine recipe not found');
  }

  return vaccine;
};

const createVaccine = async (data, userId) => {
  // Calculate totals
  let totalQuantity = 0;
  let totalCost = 0;

  for (const medicine of data.medicines) {
    const stock = await Stock.findById(medicine.medicine);
    if (!stock) {
      throw ApiError.notFound(`Medicine ${medicine.medicine} not found`);
    }

    if (stock.category !== 'Medication') {
      throw ApiError.badRequest(`Stock item ${stock.productName} is not a medication`);
    }
    
    medicine.name = stock.productName;
    medicine.unit = stock.unit;
    medicine.ratePerUnit = stock.openingRatePerUnit || stock.costPerUnit || 0;
    medicine.currentStock = stock.currentQty;
    medicine.total = medicine.quantity * medicine.ratePerUnit;
    
    totalQuantity += medicine.quantity;
    totalCost += medicine.total;
  }

  data.totalQuantity = totalQuantity;
  data.totalCost = totalCost;

  const vaccine = await VaccineRecipe.create({
    ...data,
    createdBy: userId
  });

  // Create audit log
  logAction({
    userId,
    action: 'Vaccine Recipe Created',
    entityType: 'VaccineRecipe',
    entityId: vaccine._id,
    metadata: {
      name: vaccine.name,
      disease: vaccine.disease,
      medicineCount: data.medicines.length,
      totalCost: totalCost
    }
  });

  return vaccine;
};

const updateVaccine = async (id, data, userId) => {
  const vaccine = await VaccineRecipe.findById(id);
  if (!vaccine) throw ApiError.notFound('Vaccine recipe not found');

  // If medicines are being updated, recalculate totals
  if (data.medicines) {
    let totalQuantity = 0;
    let totalCost = 0;

    for (const medicine of data.medicines) {
      const stock = await Stock.findById(medicine.medicine);
      if (!stock) {
        throw ApiError.notFound(`Medicine ${medicine.medicine} not found`);
      }

      if (stock.category !== 'Medication') {
        throw ApiError.badRequest(`Stock item ${stock.productName} is not a medication`);
      }
      
      medicine.name = stock.productName;
      medicine.unit = stock.unit;
      medicine.ratePerUnit = stock.openingRatePerUnit || stock.costPerUnit || 0;
      medicine.currentStock = stock.currentQty;
      medicine.total = medicine.quantity * medicine.ratePerUnit;
      
      totalQuantity += medicine.quantity;
      totalCost += medicine.total;
    }

    data.totalQuantity = totalQuantity;
    data.totalCost = totalCost;
  }

  Object.assign(vaccine, data);
  await vaccine.save();

  // Create audit log
  logAction({
    userId,
    action: 'Vaccine Recipe Updated',
    entityType: 'VaccineRecipe',
    entityId: vaccine._id,
    metadata: {
      name: vaccine.name,
      disease: vaccine.disease,
      changes: data
    }
  });

  return vaccine;
};

const deleteVaccine = async (id, userId) => {
  const vaccine = await VaccineRecipe.findById(id);
  if (!vaccine) throw ApiError.notFound('Vaccine recipe not found');

  // Check if vaccine is used in any applications
  const usageCount = await VaccineApplication.countDocuments({
    vaccineRecipe: id
  });

  if (usageCount > 0) {
    throw ApiError.badRequest('Cannot delete vaccine recipe that has been applied');
  }

  await VaccineRecipe.findByIdAndDelete(id);

  // Create audit log
  logAction({
    userId,
    action: 'Vaccine Recipe Deleted',
    entityType: 'VaccineRecipe',
    entityId: vaccine._id,
    metadata: {
      name: vaccine.name,
      disease: vaccine.disease,
      totalCost: vaccine.totalCost
    }
  });
};

// ============ APPLICATION SERVICES ============

const getApplications = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  const filter = {};
  if (query.scope) filter.scope = query.scope;
  if (query.pen) filter.pen = query.pen;
  if (query.animal) filter.animal = query.animal;
  if (query.vaccineRecipe) filter.vaccineRecipe = query.vaccineRecipe;
  
  if (query.dateFrom || query.dateTo) {
    filter.date = {};
    if (query.dateFrom) filter.date.$gte = new Date(query.dateFrom);
    if (query.dateTo) filter.date.$lte = new Date(query.dateTo);
  }

  if (query.search) {
    filter.$or = [
      { vaccineName: { $regex: query.search, $options: 'i' } },
      { disease: { $regex: query.search, $options: 'i' } }
    ];
  }

  const [applications, total] = await Promise.all([
    VaccineApplication.find(filter)
      .populate('vaccineRecipe', 'name disease')
      .populate('pen', 'name')
      .populate('animal', 'tagNumber name')
      .populate('animals', 'tagNumber name')
      .populate('medicineUsed.medicine', 'productName')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    VaccineApplication.countDocuments(filter)
  ]);

  return {
    data: applications,
    meta: getPaginationMeta(total, page, limit)
  };
};

const applyVaccine = async (data, userId) => {
  const { scope, pen, animal, animals, vaccineRecipeId, ...rest } = data;

  // Get vaccine recipe
  const vaccineRecipe = await VaccineRecipe.findById(vaccineRecipeId);
  if (!vaccineRecipe) {
    throw ApiError.notFound('Vaccine recipe not found');
  }

  // Validate scope-specific requirements
  if (scope === 'Pen' && !pen) {
    throw ApiError.badRequest('Pen is required for pen-wide vaccination');
  }
  if (scope === 'Individual' && !animal) {
    throw ApiError.badRequest('Animal is required for individual vaccination');
  }
  if (scope === 'Multiple' && (!animals || animals.length === 0)) {
    throw ApiError.badRequest('Animals are required for multiple animal vaccination');
  }

  // Get animal count based on scope
  let animalCount = 0;
  let targetAnimals = [];
  let penName = '';

  if (scope === 'Pen') {
    const penDoc = await Pen.findById(pen);
    if (!penDoc) throw ApiError.notFound('Pen not found');
    
    targetAnimals = await Animal.find({ pen, status: 'Active' });
    animalCount = targetAnimals.length;
    penName = penDoc.name;
  } else if (scope === 'Individual') {
    const animalDoc = await Animal.findById(animal);
    if (!animalDoc) throw ApiError.notFound('Animal not found');
    
    targetAnimals = [animalDoc];
    animalCount = 1;
  } else if (scope === 'Multiple') {
    targetAnimals = await Animal.find({ _id: { $in: animals }, status: 'Active' });
    if (targetAnimals.length !== animals.length) {
      throw ApiError.badRequest('Some animals not found or inactive');
    }
    animalCount = targetAnimals.length;
  }

  if (animalCount === 0) {
    throw ApiError.badRequest('No animals found for vaccination');
  }

  // Calculate medicine quantities based on recipe and animal count.
  // Snapshot rates outside the txn since they're read-only.
  let totalCost = 0;
  const processedMedicines = [];
  for (const recipeMedicine of vaccineRecipe.medicines) {
    const medicine = await Stock.findById(recipeMedicine.medicine);
    if (!medicine) {
      throw ApiError.notFound(`Medicine ${recipeMedicine.name} not found`);
    }
    const requiredQuantity = recipeMedicine.quantity * animalCount;
    const rate = medicine.costPerUnit || medicine.openingRatePerUnit || 0;
    const total = requiredQuantity * rate;
    processedMedicines.push({
      medicine: medicine._id,
      medicineName: medicine.productName,
      quantity: requiredQuantity,
      unit: medicine.unit,
      rate,
      total
    });
    totalCost += total;
  }

  const application = await withTransaction(async (session) => {
    // ── Atomic stock deductions ──────────────────────────────────────────
    // Single conditional findOneAndUpdate per medicine. If any fails (because
    // a concurrent caller drained it), the transaction aborts and prior
    // deductions roll back (on replica set).
    for (const med of processedMedicines) {
      const updated = await Stock.findOneAndUpdate(
        { _id: med.medicine, currentQty: { $gte: med.quantity } },
        { $inc: { currentQty: -med.quantity } },
        { new: true, ...(session ? { session } : {}) }
      );
      if (!updated) {
        const probe = await Stock.findById(med.medicine, 'productName currentQty unit')
          .session(session || null)
          .lean();
        throw ApiError.badRequest(
          `Insufficient stock for ${probe?.productName || med.medicineName}. ` +
          `Available: ${probe?.currentQty ?? 0} ${probe?.unit || med.unit}, ` +
          `Required: ${med.quantity}`
        );
      }
    }

    // Create application
    const [created] = await VaccineApplication.create(
      [{
        ...rest,
        vaccineRecipe: vaccineRecipeId,
        vaccineName: vaccineRecipe.name,
        disease: vaccineRecipe.disease,
        scope,
        pen: scope === 'Pen' ? pen : undefined,
        penName: scope === 'Pen' ? penName : undefined,
        animal: scope === 'Individual' ? animal : undefined,
        animals: scope === 'Multiple' ? animals : undefined,
        animalCount,
        medicineUsed: processedMedicines,
        totalCost,
        createdBy: userId
      }],
      session ? { session } : {}
    );

    // Recipe counter (atomic)
    await VaccineRecipe.findByIdAndUpdate(
      vaccineRecipeId,
      { $inc: { appliedCount: 1 } },
      session ? { session } : {}
    );

    // Distribute cost across the targeted animals.
    if (totalCost > 0 && animalCount > 0) {
      const costPerAnimal = Math.floor((totalCost / animalCount) * 100) / 100;
      const remainder = Math.round((totalCost - (costPerAnimal * animalCount)) * 100) / 100;
      const animalIds = targetAnimals.map(a => a._id);
      await Animal.updateMany(
        { _id: { $in: animalIds }, status: 'Active' },
        { $inc: { totalVaccinationCost: costPerAnimal } },
        session ? { session } : {}
      );
      if (remainder > 0 && animalIds.length > 0) {
        // X4 (Sprint 5): random index in animalIds rather than always [0].
        // Math.random is fine here — we're distributing rounding paisa, not
        // doing crypto.
        const pickIdx = Math.floor(Math.random() * animalIds.length);
        await Animal.findByIdAndUpdate(
          animalIds[pickIdx],
          { $inc: { totalVaccinationCost: remainder } },
          session ? { session } : {}
        );
      }
    }

    return created;
  });

  logAction({
    userId,
    action: 'Vaccine Applied',
    entityType: 'VaccineApplication',
    entityId: application._id,
    metadata: {
      vaccineName: vaccineRecipe.name,
      disease: vaccineRecipe.disease,
      scope,
      animalCount,
      penName: penName || 'N/A',
      totalCost,
      medicineCount: processedMedicines.length
    }
  });

  return application.populate([
    { path: 'vaccineRecipe', select: 'name disease' },
    { path: 'pen', select: 'name' },
    { path: 'animal', select: 'tagNumber name' },
    { path: 'animals', select: 'tagNumber name' }
  ]);
};

const getApplicationById = async (id) => {
  const application = await VaccineApplication.findById(id)
    .populate('vaccineRecipe', 'name disease description')
    .populate('pen', 'name capacity')
    .populate('animal', 'tagNumber name breed')
    .populate('animals', 'tagNumber name breed')
    .populate('medicineUsed.medicine', 'productName brandName');

  if (!application) {
    throw ApiError.notFound('Vaccination application not found');
  }

  return application;
};

const deleteApplication = async (id, userId) => {
  const application = await VaccineApplication.findById(id);
  if (!application) throw ApiError.notFound('Vaccination application not found');

  await withTransaction(async (session) => {
    // Restore stock quantities atomically
    for (const med of application.medicineUsed) {
      await Stock.findByIdAndUpdate(
        med.medicine,
        { $inc: { currentQty: med.quantity } },
        session ? { session } : {}
      );
    }

    // Reverse vaccination cost from animals.
    //
    // Bug fix: scope is stored as 'Pen' | 'Individual' | 'Multiple' (see
    // VACCINATION_SCOPES + applyVaccine). This block previously checked
    // 'All Animals' | 'Pen' | 'Individual Animal', so deleting an Individual
    // or Multiple vaccination NEVER reversed the cost — money silently stayed
    // on the animals. We now match the real scope values AND mirror the exact
    // distribution applyVaccine used (floor to paisa + remainder on one
    // animal) so the reversal nets to the original totalCost.
    if (application.totalCost > 0) {
      const scope = application.scope;
      let filter = null;
      if (scope === 'Pen' && application.pen) {
        filter = { pen: application.pen, status: 'Active' };
      } else if (scope === 'Multiple' && application.animals && application.animals.length) {
        filter = { _id: { $in: application.animals }, status: 'Active' };
      } else if (scope === 'Individual' && application.animal) {
        filter = { _id: application.animal };
      }

      if (filter) {
        const animalCount = application.animalCount
          || (scope === 'Individual' ? 1 : 0);
        if (animalCount > 0) {
          const costPerAnimal =
            Math.floor((application.totalCost / animalCount) * 100) / 100;
          const remainder =
            Math.round((application.totalCost - costPerAnimal * animalCount) * 100) / 100;

          if (costPerAnimal > 0) {
            await Animal.updateMany(
              filter,
              { $inc: { totalVaccinationCost: -costPerAnimal } },
              session ? { session } : {}
            );
          }
          // The remainder paisa went to one animal at apply-time; we can't
          // know which, so subtract it from any one in the set — the
          // aggregate reversal is still exactly application.totalCost.
          if (remainder > 0) {
            const one = await Animal.findOne(filter, '_id')
              .session(session || null)
              .lean();
            if (one) {
              await Animal.findByIdAndUpdate(
                one._id,
                { $inc: { totalVaccinationCost: -remainder } },
                session ? { session } : {}
              );
            }
          }
        }
      }
    }

    // Recipe counter atomic decrement (clamped at 0)
    await VaccineRecipe.findOneAndUpdate(
      { _id: application.vaccineRecipe, appliedCount: { $gt: 0 } },
      { $inc: { appliedCount: -1 } },
      session ? { session } : {}
    );

    await VaccineApplication.findByIdAndDelete(id, session ? { session } : {});
  });

  // Create audit log
  logAction({
    userId,
    action: 'Vaccine Application Deleted',
    entityType: 'VaccineApplication',
    entityId: application._id,
    metadata: {
      vaccineName: application.vaccineName,
      disease: application.disease,
      scope: application.scope,
      animalCount: application.animalCount,
      totalCost: application.totalCost
    }
  });
};

module.exports = {
  getAllVaccines,
  getVaccineById,
  createVaccine,
  updateVaccine,
  deleteVaccine,
  getApplications,
  applyVaccine,
  getApplicationById,
  deleteApplication
};
