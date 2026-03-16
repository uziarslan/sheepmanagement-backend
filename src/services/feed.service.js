const { FeedRecipe, FeedApplication, Stock, Animal, Pen } = require('../models');
const logger = require('../utils/logger');
const { ApiError, getPaginationOptions, getSortOptions, getPaginationMeta, logAction } = require('../utils');

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
  const recipe = await FeedRecipe.findByIdAndDelete(id);
  if (!recipe) throw ApiError.notFound('Recipe not found');
  
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

  // Get animal count in pen
  const animalCount = await Animal.countDocuments({ 
    pen: data.pen, 
    status: 'Active' 
  });

  // ── FIFO stock validation & deduction ──────────────────────────────────────
  // For each recipe ingredient, find ALL stock entries with the same productName
  // and openingRatePerUnit, sorted oldest purchaseDate first, and drain them FIFO.
  // We collect deduction ops here and execute them after the application is saved.
  const deductionOps = []; // [{ stockDoc, deductQty }]

  for (const ing of recipe.ingredients) {
    const ingName = ing.name;
    // Load a reference stock to get the rate
    const refStock = await Stock.findById(ing.stock);
    if (!refStock) {
      throw ApiError.notFound(`Stock item "${ingName}" not found`);
    }
    const ingRate = refStock.openingRatePerUnit;

    // Fetch all stock docs with same productName + rate, sorted oldest first
    const matchingStocks = await Stock.find({
      productName: { $regex: new RegExp(`^${ingName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      openingRatePerUnit: ingRate,
      category: refStock.category
    }).sort({ purchaseDate: 1 });

    logger.info(`[feed.service] FIFO for "${ingName}" rate=${ingRate}: found ${matchingStocks.length} entries, need ${ing.quantity}`);

    // Check combined availability
    const totalAvailable = matchingStocks.reduce((s, st) => s + (st.currentQty || 0), 0);
    if (totalAvailable < ing.quantity) {
      throw ApiError.badRequest(
        `Insufficient stock for ${ingName}. Total available: ${totalAvailable} ${ing.unit}, needed: ${ing.quantity}`
      );
    }

    // Build FIFO deduction splits
    let remaining = ing.quantity;
    for (const st of matchingStocks) {
      if (remaining <= 0) break;
      if ((st.currentQty || 0) <= 0) continue;
      const deductQty = Math.min(remaining, st.currentQty);
      deductionOps.push({ stockDoc: st, deductQty });
      logger.info(`[feed.service]   → deduct ${deductQty} from stock ${st._id} (purchaseDate=${st.purchaseDate}, currentQty=${st.currentQty})`);
      remaining -= deductQty;
    }
  }

  // Calculate cost per animal with proper float rounding
  let costPerAnimal = 0;
  if (animalCount > 0) {
    costPerAnimal = Math.floor(recipe.totalCost * 100 / animalCount) / 100;
  }

  // Prepare application data
  const applicationData = {
    recipe: recipe._id,
    recipeName: recipe.name,
    pen: pen._id,
    penName: pen.name,
    date: data.date || new Date(),
    animalCount,
    ingredients: recipe.ingredients.map(ing => ({
      stock: ing.stock,
      name: ing.name,
      unit: ing.unit,
      quantity: ing.quantity,
      rate: ing.ratePerUnit,
      total: ing.total
    })),
    totalCost: recipe.totalCost,
    costPerAnimal,
    notes: data.notes,
    appliedBy: userId,
    createdBy: userId
  };

  // P1-05 FIX: Execute ALL stock deductions FIRST, before saving the application.
  // If any deduction fails here, no application record is created — no partial commit.
  for (const { stockDoc, deductQty } of deductionOps) {
    stockDoc.currentQty -= deductQty;
    await stockDoc.save();
  }

  // Only save application AFTER all deductions succeed
  const application = await FeedApplication.create(applicationData);

  // Create audit log
  logAction({
    userId,
    action: 'Feed Recipe Applied',
    entityType: 'FeedApplication',
    entityId: application._id,
    metadata: {
      recipeName: recipe.name,
      penName: pen.name,
      animalCount: animalCount,
      ingredientCount: recipe.ingredients.length,
      totalCost: recipe.totalCost,
      costPerAnimal
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
