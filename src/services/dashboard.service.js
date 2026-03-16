const {
  Animal,
  Pen,
  Stock,
  Employee,
  Capital,
  Treatment,
  Vaccination,
  FeedApplication
} = require('../models');

// P6-04: Simple in-memory cache with 60-second TTL to avoid 10+ parallel DB queries on every page load
const _cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

const getCached = (key) => {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
  return null;
};
const setCache = (key, data) => _cache.set(key, { data, ts: Date.now() });
const invalidateCache = (prefix) => {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
};

/**
 * Get dashboard statistics (cached 60 s per userId)
 */
const getStats = async (userId) => {
  const cacheKey = `stats_${userId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  const [
    totalAnimals,
    activeAnimals,
    totalPens,
    totalStockItems,
    totalEmployees,
    activeEmployees,
    capital,
    lowStockItems,
    recentTreatments,
    uncuredTreatments
  ] = await Promise.all([
    Animal.countDocuments(),
    Animal.countDocuments({ status: 'Active' }),
    Pen.countDocuments({ isActive: true }),
    Stock.countDocuments({ isActive: true }),
    Employee.countDocuments(),
    Employee.countDocuments({ status: 'Active' }),
    Capital.findOne({ user: userId }),
    Stock.countDocuments({
      isActive: true,
      $expr: { $lte: ['$currentQty', '$minStockLevel'] }
    }),
    Treatment.countDocuments({
      date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }),
    Treatment.countDocuments({ cureStatus: { $in: ['In Treatment', 'Uncured'] } })
  ]);

  // Calculate total values
  const [animalValue, stockValue] = await Promise.all([
    Animal.aggregate([
      { $match: { status: 'Active' } },
      {
        $group: {
          _id: null,
          totalPurchaseValue: { $sum: '$purchasePrice' },
          totalFeedCost: { $sum: '$totalFeedCost' },
          totalHealthCost: { $sum: '$totalHealthCost' }
        }
      }
    ]),
    Stock.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          totalValue: { $sum: { $multiply: ['$currentQty', '$openingRatePerUnit'] } }
        }
      }
    ])
  ]);

  // Animal stats by type
  const animalsByType = await Animal.aggregate([
    { $match: { status: 'Active' } },
    {
      $group: {
        _id: '$animalType',
        count: { $sum: 1 }
      }
    }
  ]);

  // Animal stats by status
  const animalsByStatus = await Animal.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  // Pen occupancy
  const penOccupancy = await Pen.aggregate([
    { $match: { isActive: true } },
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
        as: 'animals'
      }
    },
    {
      $project: {
        name: 1,
        type: 1,
        capacity: 1,
        animalCount: { $size: '$animals' },
        occupancy: {
          $multiply: [
            { $divide: [{ $size: '$animals' }, '$capacity'] },
            100
          ]
        }
      }
    }
  ]);

  // Return flat structure for frontend compatibility
  const result = {
    // Animal stats
    totalAnimals,
    activeAnimals,
    animalsByType,
    animalsByStatus,
    totalAnimalValue: animalValue[0]?.totalPurchaseValue || 0,
    totalFeedCost: animalValue[0]?.totalFeedCost || 0,
    totalHealthCost: animalValue[0]?.totalHealthCost || 0,

    // Pen stats
    totalPens,
    penOccupancy,

    // Stock stats
    totalStockItems,
    lowStockItems,
    totalStockValue: stockValue[0]?.totalValue || 0,

    // Employee stats
    totalEmployees,
    activeEmployees,

    // Capital stats
    totalCapital: capital?.totalCapital || 0,
    investedCapital: capital?.investedAmount || 0,
    availableCapital: capital?.availableAmount || 0,

    // Health stats
    recentTreatments,
    uncuredTreatments
  };

  setCache(cacheKey, result);
  return result;
};

/**
 * Get recent activities
 */
const getRecentActivities = async (userId, limit = 10) => {
  const [animals, treatments, vaccinations, feedApplications] = await Promise.all([
    Animal.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('tagId name animalType createdAt')
      .lean(),
    Treatment.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('animal', 'tagId name')
      .select('diagnosis cureStatus date')
      .lean(),
    Vaccination.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('scope animalCount date')
      .lean(),
    FeedApplication.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('recipeName penName totalCost date')
      .lean()
  ]);

  // Combine and format activities
  const activities = [
    ...animals.map(a => ({
      type: 'animal_added',
      message: `New ${a.animalType.toLowerCase()} added: ${a.tagId}`,
      date: a.createdAt
    })),
    ...treatments.map(t => ({
      type: 'treatment',
      message: `Treatment for ${t.animal?.tagId || 'Unknown'}: ${t.diagnosis}`,
      date: t.date
    })),
    ...vaccinations.map(v => ({
      type: 'vaccination',
      message: `Vaccination (${v.scope}): ${v.animalCount} animals`,
      date: v.date
    })),
    ...feedApplications.map(f => ({
      type: 'feed',
      message: `Feed applied to ${f.penName}: ${f.recipeName}`,
      date: f.date
    }))
  ];

  // Sort by date and limit
  return activities
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
};

module.exports = {
  getStats,
  getRecentActivities,
  invalidateDashboardCache: () => invalidateCache('stats_') // exported for other services to call
};
