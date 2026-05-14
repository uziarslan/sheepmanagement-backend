const { FeedRecipe, FeedApplication, Stock, Animal, Pen } = require('../models');
const logger = require('../utils/logger');
const {
  ApiError,
  getPaginationOptions,
  getSortOptions,
  getPaginationMeta,
  logAction,
  withTransaction,
  sampleActiveAnimal
} = require('../utils');

// ============ RECIPE SERVICES ============

const getAllRecipes = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-createdAt');

  const filter = {};
  if (query.pen) filter.pen = query.pen;
  if (query.isActive !== undefined) filter.isActive = query.isActive;

  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { description: { $regex: query.search, $options: 'i' } }
    ];
  }

  const [recipes, total] = await Promise.all([
    FeedRecipe.find(filter)
      .populate('pen', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    FeedRecipe.countDocuments(filter)
  ]);

  return {
    data: recipes,
    meta: getPaginationMeta(total, page, limit)
  };
};

const getRecipeById = async (id) => {
  const recipe = await FeedRecipe.findById(id)
    .populate('pen', 'name capacity');

  if (!recipe) {
    throw ApiError.notFound('Recipe not found');
  }

  // Get pen animal count for cost per animal calculation
  const animalCount = await Animal.countDocuments({ 
    pen: recipe.pen._id, 
    status: 'Active' 
  });

  return {
    ...recipe.toObject(),
    animalCount,
    costPerAnimal: animalCount > 0 ? recipe.totalCost / animalCount : 0
  };
};

const createRecipe = async (data, userId) => {
  // Validate pen exists
  const pen = await Pen.findById(data.pen);
  if (!pen) throw ApiError.notFound('Pen not found');

  data.penName = pen.name;

  // Calculate totals
  let totalQuantity = 0;
  let totalCost = 0;

  for (const ingredient of data.ingredients) {
    const stock = await Stock.findById(ingredient.stock);
    if (!stock) {
      throw ApiError.notFound(`Stock item ${ingredient.stock} not found`);
    }
    
    ingredient.name = stock.productName;
    ingredient.unit = stock.unit;
    ingredient.ratePerUnit = stock.openingRatePerUnit;
    ingredient.currentStock = stock.currentQty;
    ingredient.total = ingredient.quantity * stock.openingRatePerUnit;
    
    totalQuantity += ingredient.quantity;
    totalCost += ingredient.total;
  }

  data.totalQuantity = totalQuantity;
  data.totalCost = totalCost;

  const recipe = await FeedRecipe.create({
    ...data,
    createdBy: userId
  });

  // Create audit log
  logAction({
    userId,
    action: 'Feed Recipe Created',
    entityType: 'FeedRecipe',
    entityId: recipe._id,
    metadata: {
      name: recipe.name,
      penName: pen.name,
      ingredientCount: data.ingredients.length,
      totalCost: totalCost
    }
  });

  return recipe.populate('pen');
};

const updateRecipe = async (id, data, userId) => {
  const recipe = await FeedRecipe.findById(id);
  if (!recipe) throw ApiError.notFound('Recipe not found');

  // If pen is being changed
  if (data.pen && data.pen !== recipe.pen.toString()) {
    const pen = await Pen.findById(data.pen);
    if (!pen) throw ApiError.notFound('Pen not found');
    data.penName = pen.name;
  }

  // If ingredients are being updated
  if (data.ingredients) {
    let totalQuantity = 0;
    let totalCost = 0;

    for (const ingredient of data.ingredients) {
      const stock = await Stock.findById(ingredient.stock);
      if (stock) {
        ingredient.name = stock.productName;
        ingredient.unit = stock.unit;
        ingredient.ratePerUnit = stock.openingRatePerUnit;
        ingredient.currentStock = stock.currentQty;
        ingredient.total = ingredient.quantity * stock.openingRatePerUnit;
      }
      
      totalQuantity += ingredient.quantity;
      totalCost += ingredient.total || 0;
    }

    data.totalQuantity = totalQuantity;
    data.totalCost = totalCost;
  }

  const updated = await FeedRecipe.findByIdAndUpdate(
    id,
    { $set: data },
    { new: true, runValidators: true }
  ).populate('pen');

  // Create audit log
  logAction({
    userId,
    action: 'Feed Recipe Updated',
    entityType: 'FeedRecipe',
    entityId: recipe._id,
    metadata: {
      name: updated.name,
      penName: updated.penName,
      changes: data
    }
  });

  return updated;
};

const deleteRecipe = async (id, userId) => {
  const recipe = await FeedRecipe.findById(id);
  if (!recipe) throw ApiError.notFound('Recipe not found');

  // Block deletion when historical applications reference this recipe.
  // Mark inactive via update if the recipe should be retired but kept on file.
  const usageCount = await FeedApplication.countDocuments({ recipe: id });
  if (usageCount > 0) {
    throw ApiError.badRequest(
      `Cannot delete recipe "${recipe.name}" — it has been applied ${usageCount} time(s). ` +
      `Set isActive=false to retire it without losing history.`
    );
  }

  await FeedRecipe.findByIdAndDelete(id);

  // Create audit log
  logAction({
    userId,
    action: 'Feed Recipe Deleted',
    entityType: 'FeedRecipe',
    entityId: recipe._id,
    metadata: {
      name: recipe.name,
      penName: recipe.penName,
      totalCost: recipe.totalCost
    }
  });

  return recipe;
};

// ============ APPLICATION SERVICES ============

const getApplications = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  const filter = {};
  if (query.recipe) filter.recipe = query.recipe;
  if (query.pen) filter.pen = query.pen;

  if (query.startDate || query.endDate) {
    filter.date = {};
    if (query.startDate) filter.date.$gte = new Date(query.startDate);
    if (query.endDate) filter.date.$lte = new Date(query.endDate);
  }

  const [applications, total] = await Promise.all([
    FeedApplication.find(filter)
      .populate('recipe', 'name')
      .populate('pen', 'name')
      .populate('appliedBy', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    FeedApplication.countDocuments(filter)
  ]);

  return {
    data: applications,
    meta: getPaginationMeta(total, page, limit)
  };
};

const applyRecipe = async (data, userId) => {
  // Validate recipe
  const recipe = await FeedRecipe.findById(data.recipe);
  if (!recipe) throw ApiError.notFound('Recipe not found');

  // Validate pen
  const pen = await Pen.findById(data.pen);
  if (!pen) throw ApiError.notFound('Pen not found');

  // Get animal count in pen (snapshot). Cost-per-animal is computed AFTER
  // FIFO settles the actual spend, since batch rates may vary.
  const animalCount = await Animal.countDocuments({
    pen: data.pen,
    status: 'Active'
  });

  const application = await withTransaction(async (session) => {
    // ── FIFO stock validation & deduction (price-tolerant) ────────────────
    // Sprint 3 (F4/S6): FIFO no longer filters by openingRatePerUnit. A stock
    // price edit after recipe creation used to break apply-recipe. Now we
    // match by productName + category, sort by purchaseDate, and compute
    // actual cost from each batch's own rate. The application's totalCost
    // reflects ACTUAL spend, which may differ from recipe.totalCost.
    //
    // Each batch may be drained with an atomic conditional decrement so two
    // parallel callers can't both drive a balance negative.
    const ingredientCostBreakdown = [];
    let actualTotalCost = 0;

    for (const ing of recipe.ingredients) {
      const ingName = ing.name;
      const refStock = await Stock.findById(ing.stock).session(session || null);
      if (!refStock) {
        throw ApiError.notFound(`Stock item "${ingName}" not found`);
      }

      const matchingStocks = await Stock.find({
        productName: { $regex: new RegExp(`^${ingName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        category: refStock.category
      })
        .sort({ purchaseDate: 1, createdAt: 1 })
        .session(session || null);

      const totalAvailable = matchingStocks.reduce((s, st) => s + (st.currentQty || 0), 0);
      if (totalAvailable < ing.quantity) {
        throw ApiError.badRequest(
          `Insufficient stock for ${ingName}. Total available: ${totalAvailable} ${ing.unit}, needed: ${ing.quantity}`
        );
      }

      let remaining = ing.quantity;
      let ingActualCost = 0;
      const batchTrail = []; // { stockId, qty, rate, cost }

      for (const st of matchingStocks) {
        if (remaining <= 0) break;
        const onHand = st.currentQty || 0;
        if (onHand <= 0) continue;
        const deductQty = Math.min(remaining, onHand);
        const batchRate = Number(st.openingRatePerUnit) || 0;

        const decResult = await Stock.findOneAndUpdate(
          { _id: st._id, currentQty: { $gte: deductQty } },
          { $inc: { currentQty: -deductQty } },
          { new: true, ...(session ? { session } : {}) }
        );
        if (!decResult) {
          throw ApiError.badRequest(
            `Stock ${st.productName} was drained concurrently; please retry.`
          );
        }
        const batchCost = deductQty * batchRate;
        ingActualCost += batchCost;
        batchTrail.push({
          stockId: st._id,
          qty: deductQty,
          rate: batchRate,
          cost: batchCost
        });
        remaining -= deductQty;
      }

      if (remaining > 0) {
        throw ApiError.badRequest(
          `Could not fully deduct ${ing.quantity} ${ing.unit} of ${ingName} (concurrent contention).`
        );
      }

      actualTotalCost += ingActualCost;
      ingredientCostBreakdown.push({
        stock: ing.stock,
        name: ing.name,
        unit: ing.unit,
        quantity: ing.quantity,
        // For backward compat: rate is the weighted-average actual rate.
        rate: ing.quantity > 0 ? ingActualCost / ing.quantity : (ing.ratePerUnit || 0),
        total: ingActualCost,
        batches: batchTrail
      });
    }

    // Recompute cost-per-animal off the ACTUAL spend (not the recipe snapshot).
    const actualCostPerAnimal = animalCount > 0
      ? Math.floor(actualTotalCost * 100 / animalCount) / 100
      : 0;
    const actualRemainder = animalCount > 0
      ? Math.round((actualTotalCost - (actualCostPerAnimal * animalCount)) * 100) / 100
      : 0;

    // Create application
    const applicationData = {
      recipe: recipe._id,
      recipeName: recipe.name,
      pen: pen._id,
      penName: pen.name,
      date: data.date || new Date(),
      animalCount,
      ingredients: ingredientCostBreakdown.map(b => ({
        stock: b.stock,
        name: b.name,
        unit: b.unit,
        quantity: b.quantity,
        rate: b.rate,
        total: b.total
      })),
      totalCost: actualTotalCost,
      costPerAnimal: actualCostPerAnimal,
      notes: data.notes,
      appliedBy: userId,
      createdBy: userId
    };

    const [created] = await FeedApplication.create(
      [applicationData],
      session ? { session } : {}
    );

    // Recipe counter (moved out of pre-save hook so it shares the session).
    await FeedRecipe.findByIdAndUpdate(
      recipe._id,
      { $inc: { appliedCount: 1 }, $set: { lastAppliedDate: new Date() } },
      session ? { session } : {}
    );

    // Distribute cost across active animals in pen using ACTUAL spend.
    if (animalCount > 0 && actualCostPerAnimal > 0) {
      await Animal.updateMany(
        { pen: pen._id, status: 'Active' },
        { $inc: { totalFeedCost: actualCostPerAnimal } },
        session ? { session } : {}
      );
      if (actualRemainder > 0) {
        // X4 (Sprint 5): pick a RANDOM active animal in the pen for the
        // remainder paisa rather than always the oldest — eliminates
        // first-animal cost-bias drift over many applications.
        const picked = await sampleActiveAnimal({ pen: pen._id }, session);
        if (picked) {
          await Animal.findByIdAndUpdate(
            picked._id,
            { $inc: { totalFeedCost: actualRemainder } },
            session ? { session } : {}
          );
        }
      }
    }

    return created;
  });

  logAction({
    userId,
    action: 'Feed Recipe Applied',
    entityType: 'FeedApplication',
    entityId: application._id,
    metadata: {
      recipeName: recipe.name,
      penName: pen.name,
      animalCount,
      ingredientCount: recipe.ingredients.length,
      recipeEstimatedCost: recipe.totalCost,
      actualTotalCost: application.totalCost,
      costPerAnimal: application.costPerAnimal
    }
  });

  return application.populate(['recipe', 'pen', 'appliedBy']);
};

/**
 * Apply a recipe across a date range (P3-09 / F-57).
 * Replaces up-to-90 sequential frontend API calls with one backend call.
 *
 * @param {{ recipe, pen, dateStart, dateEnd, notes }} data
 * @param {string} userId
 * @returns {{ succeeded: object[], failed: { date: string, error: string }[] }}
 */
const applyRecipeRange = async (data, userId) => {
  const { recipe, pen, dateStart, dateEnd, notes } = data;

  // Build the list of ISO date strings in the range (inclusive, max 90)
  const start = new Date(dateStart);
  const end   = new Date(dateEnd);
  const MAX_DAYS = 90;
  const dates = [];
  for (let d = new Date(start); d <= end && dates.length < MAX_DAYS; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d).toISOString().split('T')[0]);
  }

  const succeeded = [];
  const failed    = [];

  for (const date of dates) {
    try {
      const application = await applyRecipe({ recipe, pen, date, notes }, userId);
      succeeded.push(application);
    } catch (err) {
      failed.push({ date, error: err.message || 'Unknown error' });
      // Continue processing remaining dates even if one fails
    }
  }

  return { succeeded, failed };
};

module.exports = {
  // Recipes
  getAllRecipes,
  getRecipeById,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  // Applications
  getApplications,
  applyRecipe,
  applyRecipeRange
};
