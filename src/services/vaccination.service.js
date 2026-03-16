const { Stock, VaccineRecipe, VaccineApplication, Animal, Pen } = require('../models');
const logger = require('../utils/logger');
const { ApiError, getPaginationOptions, getSortOptions, getPaginationMeta, logAction } = require('../utils');

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

  // Calculate medicine quantities based on recipe and animal count
  let totalCost = 0;
  const processedMedicines = [];

  for (const recipeMedicine of vaccineRecipe.medicines) {
    const medicine = await Stock.findById(recipeMedicine.medicine);
    if (!medicine) {
      throw ApiError.notFound(`Medicine ${recipeMedicine.name} not found`);
    }

    // Calculate required quantity (recipe quantity * animal count)
    const requiredQuantity = recipeMedicine.quantity * animalCount;

    // Check if enough stock available
    if (medicine.currentQty < requiredQuantity) {
      throw ApiError.badRequest(
        `Insufficient stock for ${medicine.productName}. Available: ${medicine.currentQty} ${medicine.unit}, Required: ${requiredQuantity} ${medicine.unit}`
      );
    }

    // Calculate cost
    const rate = medicine.costPerUnit || medicine.openingRatePerUnit || 0;
    const total = requiredQuantity * rate;

    processedMedicines.push({
      medicine: medicine._id,
      medicineName: medicine.productName,
      quantity: requiredQuantity,
      unit: medicine.unit,
      rate: rate,
      total: total
    });

    totalCost += total;

    // Update stock quantity
    medicine.currentQty -= requiredQuantity;
    await medicine.save();
  }

  // Create application record
  const application = await VaccineApplication.create({
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
  });

  // Update vaccine recipe applied count
  vaccineRecipe.appliedCount += 1;
  await vaccineRecipe.save();

  // Distribute vaccination cost to animals with proper rounding
  if (totalCost > 0 && animalCount > 0) {
    const costPerAnimal = Math.floor((totalCost / animalCount) * 100) / 100;
    const remainder = Math.round((totalCost - (costPerAnimal * animalCount)) * 100) / 100;
    const animalIds = targetAnimals.map(a => a._id);
    await Animal.updateMany(
      { _id: { $in: animalIds }, status: 'Active' },
      { $inc: { totalVaccinationCost: costPerAnimal } }
    );
    // Add remainder to first animal
    if (remainder > 0 && animalIds.length > 0) {
      await Animal.findByIdAndUpdate(animalIds[0], {
        $inc: { totalVaccinationCost: remainder }
      });
    }
  }

  // Create audit log
  logAction({
    userId,
    action: 'Vaccine Applied',
    entityType: 'VaccineApplication',
    entityId: application._id,
    metadata: {
      vaccineName: vaccineRecipe.name,
      disease: vaccineRecipe.disease,
      scope: scope,
      animalCount: animalCount,
      penName: penName || 'N/A',
      totalCost: totalCost,
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

  // Restore stock quantities
  for (const med of application.medicineUsed) {
    const medicine = await Stock.findById(med.medicine);
    if (medicine) {
      medicine.currentQty += med.quantity;
      await medicine.save();
    }
  }

  // Reverse vaccination cost from animals
  try {
    if (application.totalCost > 0) {
      if (application.scope === 'All Animals') {
        // Reverse cost from all active animals
        const activeAnimals = await Animal.find({ status: 'Active' });
        if (activeAnimals.length > 0) {
          const costPerAnimal = application.totalCost / activeAnimals.length;
          await Animal.updateMany(
            { status: 'Active' },
            { $inc: { totalVaccinationCost: -costPerAnimal } }
          );
        }
      } else if (application.scope === 'Pen' && application.pen) {
        // Reverse cost from pen animals
        const penAnimals = await Animal.find({ pen: application.pen, status: 'Active' });
        if (penAnimals.length > 0) {
          const costPerAnimal = application.totalCost / penAnimals.length;
          await Animal.updateMany(
            { pen: application.pen, status: 'Active' },
            { $inc: { totalVaccinationCost: -costPerAnimal } }
          );
        }
      } else if (application.scope === 'Individual Animal' && application.animal) {
        // Reverse full cost from one animal
        await Animal.findByIdAndUpdate(
          application.animal,
          { $inc: { totalVaccinationCost: -application.totalCost } }
        );
      }
    }
  } catch (err) {
    // Log error but continue with deletion
    logger.error('Failed to reverse vaccination cost from animals:', err.message || err);
  }

  // Update vaccine recipe applied count
  const vaccineRecipe = await VaccineRecipe.findById(application.vaccineRecipe);
  if (vaccineRecipe && vaccineRecipe.appliedCount > 0) {
    vaccineRecipe.appliedCount -= 1;
    await vaccineRecipe.save();
  }

  await VaccineApplication.findByIdAndDelete(id);

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
