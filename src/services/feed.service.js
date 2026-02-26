const { FeedRecipe, FeedApplication, Stock, Animal, Pen } = require('../models');
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

    console.info(`[feed.service] FIFO for "${ingName}" rate=${ingRate}: found ${matchingStocks.length} entries, need ${ing.quantity}`);

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
      console.info(`[feed.service]   → deduct ${deductQty} from stock ${st._id} (purchaseDate=${st.purchaseDate}, currentQty=${st.currentQty})`);
      remaining -= deductQty;
    }
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
    costPerAnimal: animalCount > 0 ? recipe.totalCost / animalCount : 0,
    notes: data.notes,
    appliedBy: userId,
    createdBy: userId
  };

  const application = await FeedApplication.create(applicationData);

  // Execute FIFO deductions now that the application is saved
  for (const { stockDoc, deductQty } of deductionOps) {
    stockDoc.currentQty -= deductQty;
    await stockDoc.save();
    console.info(`[feed.service]   ✓ stock ${stockDoc._id} currentQty updated to ${stockDoc.currentQty}`);
  }

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
      costPerAnimal: animalCount > 0 ? recipe.totalCost / animalCount : 0
    }
  });

  return application.populate(['recipe', 'pen', 'appliedBy']);
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
  applyRecipe
};
