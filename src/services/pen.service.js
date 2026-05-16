const { Pen, Animal } = require('../models');
const {
  ApiError,
  getPaginationOptions,
  getSortOptions,
  getPaginationMeta,
  logAction,
  diffFields
} = require('../utils');

/**
 * Get all pens with animal counts
 */
const getAll = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-createdAt');

  // Build filter
  const filter = {};
  if (query.type) filter.type = query.type;
  if (query.isActive !== undefined) filter.isActive = query.isActive;

  // Use aggregation to get animal counts
  const pens = await Pen.aggregate([
    { $match: filter },
    {
      $lookup: {
        from: 'animals',
        let: { penId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$pen', '$$penId'] },
                  { $eq: ['$status', 'Active'] }
                ]
              }
            }
          }
        ],
        as: 'activeAnimals'
      }
    },
    {
      $addFields: {
        animalCount: { $size: '$activeAnimals' },
        occupancyPercentage: {
          $multiply: [
            { $divide: [{ $size: '$activeAnimals' }, '$capacity'] },
            100
          ]
        }
      }
    },
    { $project: { activeAnimals: 0 } },
    { $sort: sort },
    { $skip: skip },
    { $limit: limit }
  ]);

  const total = await Pen.countDocuments(filter);

  return {
    data: pens,
    meta: getPaginationMeta(total, page, limit)
  };
};

/**
 * Get pen by ID
 */
const getById = async (id) => {
  const pen = await Pen.findById(id);

  if (!pen) {
    throw ApiError.notFound('Pen not found');
  }

  // Get animal count
  const animalCount = await Animal.countDocuments({ pen: id, status: 'Active' });

  return {
    ...pen.toObject(),
    animalCount,
    occupancyPercentage: Math.round((animalCount / pen.capacity) * 100)
  };
};

/**
 * Create pen
 */
const create = async (penData, userId) => {
  const pen = await Pen.create({
    ...penData,
    createdBy: userId
  });

  logAction({
    userId,
    action: 'Pen Created',
    entityType: 'Pen',
    entityId: pen._id,
    metadata: {
      name: pen.name,
      type: pen.type,
      capacity: pen.capacity
    }
  });

  return {
    ...pen.toObject(),
    animalCount: 0,
    occupancyPercentage: 0
  };
};

/**
 * Update pen
 */
const update = async (id, updateData, userId) => {
  const beforeDoc = await Pen.findById(id).lean();
  if (!beforeDoc) throw ApiError.notFound('Pen not found');

  const pen = await Pen.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  const animalCount = await Animal.countDocuments({ pen: id, status: 'Active' });

  const diff = diffFields(beforeDoc, pen.toObject(), Object.keys(updateData));
  logAction({
    userId,
    action: 'Pen Updated',
    entityType: 'Pen',
    entityId: pen._id,
    metadata: {
      name: pen.name,
      diff
    }
  });

  return {
    ...pen.toObject(),
    animalCount,
    occupancyPercentage: Math.round((animalCount / pen.capacity) * 100)
  };
};

/**
 * Delete pen
 */
const remove = async (id, userId) => {
  // Check for animals in pen
  const animalCount = await Animal.countDocuments({ pen: id, status: 'Active' });

  if (animalCount > 0) {
    throw ApiError.badRequest('Cannot delete pen with active animals. Move animals first.');
  }

  const pen = await Pen.findByIdAndDelete(id);

  if (!pen) {
    throw ApiError.notFound('Pen not found');
  }

  logAction({
    userId,
    action: 'Pen Deleted',
    entityType: 'Pen',
    entityId: pen._id,
    metadata: {
      name: pen.name,
      type: pen.type,
      capacity: pen.capacity
    }
  });

  return pen;
};

/**
 * Get pen statistics
 */
const getStats = async () => {
  const stats = await Pen.aggregate([
    {
      $lookup: {
        from: 'animals',
        let: { penId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$pen', '$$penId'] },
                  { $eq: ['$status', 'Active'] }
                ]
              }
            }
          }
        ],
        as: 'activeAnimals'
      }
    },
    {
      $group: {
        _id: '$type',
        totalPens: { $sum: 1 },
        totalCapacity: { $sum: '$capacity' },
        totalAnimals: { $sum: { $size: '$activeAnimals' } }
      }
    }
  ]);

  return stats;
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  getStats
};
