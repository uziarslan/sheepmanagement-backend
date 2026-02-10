const { Animal, Pen } = require('../models');
const { ApiError, getPaginationOptions, getSortOptions, getPaginationMeta } = require('../utils');

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

  // Validate pen exists
  if (animalData.pen) {
    const pen = await Pen.findById(animalData.pen);
    if (!pen) {
      throw ApiError.notFound('Pen not found');
    }
  }

  const animal = await Animal.create({
    ...animalData,
    createdBy: userId
  });

  return animal.populate('pen', 'name type');
};

/**
 * Bulk create animals
 */
const bulkCreate = async (animalsData, userId) => {
  const results = {
    success: [],
    failed: []
  };

  for (const animalData of animalsData) {
    try {
      // Check for duplicate tagId
      if (animalData.tagId) {
        const existing = await Animal.findOne({ tagId: animalData.tagId });
        if (existing) {
          results.failed.push({
            data: animalData,
            error: `Tag ID ${animalData.tagId} already exists`
          });
          continue;
        }
      }

      const animal = await Animal.create({
        ...animalData,
        createdBy: userId
      });

      results.success.push(animal);
    } catch (error) {
      results.failed.push({
        data: animalData,
        error: error.message
      });
    }
  }

  return results;
};

/**
 * Update animal
 */
const update = async (id, updateData) => {
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

  return animal;
};

/**
 * Delete animal
 */
const remove = async (id) => {
  const animal = await Animal.findByIdAndDelete(id);

  if (!animal) {
    throw ApiError.notFound('Animal not found');
  }

  return animal;
};

/**
 * Move animal to pen
 */
const moveToPen = async (animalId, penId) => {
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

  animal.pen = penId;
  await animal.save();

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
 * Declare animal as dead and distribute its cost among remaining active animals
 */
const declareDead = async (id, deathData) => {
  const animal = await Animal.findById(id);

  if (!animal) {
    throw ApiError.notFound('Animal not found');
  }

  if (animal.status === 'Dead') {
    throw ApiError.badRequest('Animal is already marked as dead');
  }

  // Calculate the animal's total cost (purchase price + all operational costs)
  const animalTotalCost = animal.purchasePrice + 
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

  // Get count of remaining active animals
  const activeAnimalCount = await Animal.countDocuments({ status: 'Active' });

  let costDistributed = 0;
  if (activeAnimalCount > 0 && animalTotalCost > 0) {
    // Distribute the dead animal's total cost among all remaining active animals
    const costPerAnimal = animalTotalCost / activeAnimalCount;
    
    await Animal.updateMany(
      { status: 'Active' },
      { $inc: { totalHealthCost: costPerAnimal } }
    );
    
    costDistributed = animalTotalCost;
  }

  return {
    animal,
    costDistributed,
    activeAnimalsCount: activeAnimalCount,
    costPerAnimal: activeAnimalCount > 0 ? animalTotalCost / activeAnimalCount : 0
  };
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
  declareDead
};
