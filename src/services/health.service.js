const {
  Vaccination,
  Treatment,
  Deworming,
  WeightRecord,
  BcsRecord,
  HoofRecord,
  Animal,
  Stock
} = require('../models');
const { ApiError, getPaginationOptions, getSortOptions, getPaginationMeta, logAction } = require('../utils');

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
  // Get animal details
  const animal = await Animal.findById(data.animal);
  if (!animal) throw ApiError.notFound('Animal not found');

  data.animalTagId = animal.tagId;
  data.animalName = animal.name;

  const treatment = await Treatment.create({
    ...data,
    createdBy: userId
  });

  // Deduct stock and update animal health cost after treatment is saved
  if (treatment.medicines && treatment.medicines.length > 0) {
    for (const med of treatment.medicines) {
      const stock = await Stock.findById(med.medicine);
      if (stock) {
        if (stock.currentQty < med.quantity) {
          throw ApiError.badRequest(`Insufficient stock for ${stock.productName}`);
        }
        stock.currentQty -= med.quantity;
        await stock.save();
      }
    }

    // Update animal health cost
    await Animal.findByIdAndUpdate(treatment.animal, {
      $inc: { totalHealthCost: treatment.totalAmount }
    });
  }

  // Create audit log
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
  const treatment = await Treatment.findByIdAndUpdate(
    id,
    { $set: data },
    { new: true, runValidators: true }
  ).populate(['animal', 'veterinarian']);

  if (!treatment) throw ApiError.notFound('Treatment not found');
  
  // Create audit log
  logAction({
    userId,
    action: 'Treatment Record Updated',
    entityType: 'Treatment',
    entityId: treatment._id,
    metadata: {
      animalTagId: treatment.animalTagId,
      diagnosis: treatment.diagnosis,
      cureStatus: treatment.cureStatus,
      changes: data
    }
  });
  
  return treatment;
};

const deleteTreatment = async (id, userId) => {
  const treatment = await Treatment.findByIdAndDelete(id);
  if (!treatment) throw ApiError.notFound('Treatment record not found');

  // Restore stock quantities
  if (treatment.medicines && treatment.medicines.length > 0) {
    for (const med of treatment.medicines) {
      const stock = await Stock.findById(med.medicine);
      if (stock) {
        stock.currentQty += med.quantity;
        await stock.save();
      }
    }
  }

  // Reverse animal health cost
  if (treatment.totalAmount > 0) {
    await Animal.findByIdAndUpdate(treatment.animal, {
      $inc: { totalHealthCost: -treatment.totalAmount }
    });
  }

  // Create audit log
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
  // Calculate animal count based on scope
  if (data.scope === 'Pen' && data.pen) {
    data.animalCount = await Animal.countDocuments({ pen: data.pen, status: 'Active' });
  } else if (data.scope === 'Individual' && data.animal) {
    data.animalCount = 1;
    const animal = await Animal.findById(data.animal);
    if (animal) data.animalTagId = animal.tagId;
  }

  const deworming = await Deworming.create({
    ...data,
    createdBy: userId
  });

  // Deduct stock and update animal deworming cost after deworming is saved
  if (deworming.medicines && deworming.medicines.length > 0) {
    for (const med of deworming.medicines) {
      const stock = await Stock.findById(med.medicine);
      if (stock) {
        if (stock.currentQty < med.quantity) {
          throw ApiError.badRequest(`Insufficient stock for ${stock.productName}`);
        }
        stock.currentQty -= med.quantity;
        await stock.save();
      }
    }

    // Distribute deworming cost to animals
    if (deworming.totalCost > 0) {
      if (deworming.scope === 'Individual' && deworming.animal) {
        // Individual animal - full cost to one animal
        await Animal.findByIdAndUpdate(deworming.animal, {
          $inc: { totalDewormingCost: deworming.totalCost }
        });
      } else if (deworming.scope === 'Pen' && deworming.pen) {
        // Pen scope - divide among active animals in pen
        const activeAnimals = await Animal.find({ pen: deworming.pen, status: 'Active' });
        if (activeAnimals.length > 0) {
          const costPerAnimal = deworming.totalCost / activeAnimals.length;
          await Animal.updateMany(
            { pen: deworming.pen, status: 'Active' },
            { $inc: { totalDewormingCost: costPerAnimal } }
          );
        }
      }
    }
  }

  // Create audit log
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
  const deworming = await Deworming.findByIdAndDelete(id);
  if (!deworming) throw ApiError.notFound('Deworming record not found');

  // Restore stock quantities
  if (deworming.medicines && deworming.medicines.length > 0) {
    for (const med of deworming.medicines) {
      const stock = await Stock.findById(med.medicine);
      if (stock) {
        stock.currentQty += med.quantity;
        await stock.save();
      }
    }
  }

  // Reverse animal deworming cost
  if (deworming.totalCost > 0) {
    if (deworming.scope === 'Individual' && deworming.animal) {
      // Individual animal - reverse full cost
      await Animal.findByIdAndUpdate(deworming.animal, {
        $inc: { totalDewormingCost: -deworming.totalCost }
      });
    } else if (deworming.scope === 'Pen' && deworming.pen) {
      // Pen scope - reverse distributed cost
      const activeAnimals = await Animal.find({ pen: deworming.pen, status: 'Active' });
      if (activeAnimals.length > 0) {
        const costPerAnimal = deworming.totalCost / activeAnimals.length;
        await Animal.updateMany(
          { pen: deworming.pen, status: 'Active' },
          { $inc: { totalDewormingCost: -costPerAnimal } }
        );
      }
    }
  }

  // Create audit log
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

const updateHoofRecord = async (id, data, userId) => {
  const record = await HoofRecord.findByIdAndUpdate(
    id,
    { $set: data },
    { new: true, runValidators: true }
  ).populate(['animal', 'technician']);

  if (!record) throw ApiError.notFound('Hoof record not found');
  
  // Create audit log
  logAction({
    userId,
    action: 'Hoof Record Updated',
    entityType: 'HoofRecord',
    entityId: record._id,
    metadata: {
      animalTagId: record.animalTagId,
      diagnosis: record.diagnosis,
      changes: data
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
  // BCS Records
  getBcsRecords,
  createBcsRecord,
  // Hoof Records
  getHoofRecords,
  createHoofRecord,
  updateHoofRecord,
  deleteHoofRecord,
  // Cure Tracking
  getCureTracking
};
