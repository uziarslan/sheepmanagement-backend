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

  // Recipe quantities/cost are PER ANIMAL (semantic change). costPerAnimal is
  // therefore just totalCost. totalCostForPen scales by the current head count
  // in the recipe's default pen, but the real spend is settled at apply-time
  // based on the pens actually targeted.
  const animalCount = await Animal.countDocuments({
    pen: recipe.pen._id,
    status: 'Active'
  });

  return {
    ...recipe.toObject(),
    animalCount,
    costPerAnimal: recipe.totalCost || 0,
    totalCostForPen: (recipe.totalCost || 0) * animalCount
  };
};

const createRecipe = async (data, userId) => {
  // Validate pen exists
  const pen = await Pen.findById(data.pen);
  if (!pen) throw ApiError.notFound('Pen not found');

  data.penName = pen.name;

  // Recipe ingredients are stored PER ANIMAL. totalQuantity / totalCost on the
  // recipe document represent the per-animal totals. The apply flow multiplies
  // by active animal count at apply-time.
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

/**
 * Apply a recipe to one or more pens.
 *
 * Semantics (changed): the recipe stores quantities and cost PER ANIMAL.
 * Apply-time math:
 *   - For each ingredient: deduct `ingredient.quantity × totalAnimalCount`
 *     from FIFO stock across all selected pens.
 *   - costPerAnimal = recipe.totalCost (settled against actual FIFO spend).
 *   - For each pen, the recorded application has:
 *       animalCount      = active animals in that pen
 *       totalCost        = costPerAnimal × animalCount
 *       ingredients[*].quantity = recipe.ing.quantity × animalCount
 *
 * Accepts:
 *   - { pen: <id>, ... }       → single-pen apply (back-compat)
 *   - { pens: [<id>, ...] }    → multi-pen apply (new)
 *
 * Returns:
 *   - single-pen mode  → the created FeedApplication (back-compat shape)
 *   - multi-pen mode   → { applications: [...], totalCost, totalAnimalCount }
 */
const applyRecipe = async (data, userId) => {
  // Validate recipe
  const recipe = await FeedRecipe.findById(data.recipe);
  if (!recipe) throw ApiError.notFound('Recipe not found');

  // Normalize pen → pens[]. Track whether the caller used single-pen mode so
  // we can return the legacy single-application shape unchanged.
  const singlePenMode = !Array.isArray(data.pens);
  const penIds = singlePenMode
    ? [data.pen]
    : data.pens;

  if (!penIds || penIds.length === 0) {
    throw ApiError.badRequest('At least one pen is required');
  }

  // De-dupe pen IDs (a UI bug shouldn't get the same pen charged twice).
  const uniquePenIds = [...new Set(penIds.map(String))];

  // Load all pens up-front so a bad ID errors out before stock is touched.
  const pens = await Pen.find({ _id: { $in: uniquePenIds } });
  if (pens.length !== uniquePenIds.length) {
    throw ApiError.notFound('One or more pens not found');
  }
  const pensById = Object.fromEntries(pens.map(p => [String(p._id), p]));

  // Snapshot active animal counts per pen.
  const penAnimalCounts = {};
  let totalAnimalCount = 0;
  for (const id of uniquePenIds) {
    const count = await Animal.countDocuments({ pen: id, status: 'Active' });
    penAnimalCounts[id] = count;
    totalAnimalCount += count;
  }

  if (totalAnimalCount === 0) {
    throw ApiError.badRequest(
      'No active animals in the selected pen(s); nothing to apply against.'
    );
  }

  const result = await withTransaction(async (session) => {
    // ── FIFO stock deduction for the COMBINED quantity ────────────────────
    // For each ingredient, we need `ing.quantity × totalAnimalCount` deducted
    // (the recipe is per-animal). FIFO sweeps batches by purchase date and
    // computes a weighted-average actual rate. The per-animal cost is then
    // settled against the actual spend, so a stock-price edit between recipe
    // creation and apply time is handled correctly (Sprint 3 F4/S6).
    const ingredientCostBreakdown = [];
    let actualTotalCost = 0;

    for (const ing of recipe.ingredients) {
      const ingName = ing.name;
      const totalQtyNeeded = (Number(ing.quantity) || 0) * totalAnimalCount;
      if (totalQtyNeeded <= 0) continue;

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
      if (totalAvailable < totalQtyNeeded) {
        throw ApiError.badRequest(
          `Insufficient stock for ${ingName}. Total available: ${totalAvailable} ${ing.unit}, ` +
          `needed: ${totalQtyNeeded} ${ing.unit} (${ing.quantity} × ${totalAnimalCount} animal${totalAnimalCount > 1 ? 's' : ''})`
        );
      }

      let remaining = totalQtyNeeded;
      let ingActualCost = 0;
      const batchTrail = [];

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
          `Could not fully deduct ${totalQtyNeeded} ${ing.unit} of ${ingName} (concurrent contention).`
        );
      }

      actualTotalCost += ingActualCost;
      ingredientCostBreakdown.push({
        stock: ing.stock,
        name: ing.name,
        unit: ing.unit,
        perAnimalQuantity: Number(ing.quantity) || 0,
        totalQuantity: totalQtyNeeded,
        // Weighted-average actual rate paid across the FIFO batches.
        rate: totalQtyNeeded > 0 ? ingActualCost / totalQtyNeeded : (ing.ratePerUnit || 0),
        totalCost: ingActualCost,
        batches: batchTrail
      });
    }

    // Per-animal cost from ACTUAL spend (consistent across all pens applied
    // to in this call — they share the same FIFO settle).
    const actualCostPerAnimal = totalAnimalCount > 0
      ? Math.floor(actualTotalCost * 100 / totalAnimalCount) / 100
      : 0;
    const actualRemainder = totalAnimalCount > 0
      ? Math.round((actualTotalCost - (actualCostPerAnimal * totalAnimalCount)) * 100) / 100
      : 0;

    // ── Create one FeedApplication per pen ────────────────────────────────
    const createdApplications = [];
    for (const penId of uniquePenIds) {
      const pen = pensById[penId];
      const count = penAnimalCounts[penId];
      if (count === 0) continue; // skip empty pens, nothing to apply against

      const penIngredients = ingredientCostBreakdown.map(b => {
        const penQty = b.perAnimalQuantity * count;
        return {
          stock: b.stock,
          name: b.name,
          unit: b.unit,
          quantity: penQty,
          rate: b.rate,
          total: penQty * b.rate
        };
      });

      const penTotalCost = Math.round(actualCostPerAnimal * count * 100) / 100;

      const [created] = await FeedApplication.create(
        [{
          recipe: recipe._id,
          recipeName: recipe.name,
          pen: pen._id,
          penName: pen.name,
          date: data.date || new Date(),
          animalCount: count,
          ingredients: penIngredients,
          totalCost: penTotalCost,
          costPerAnimal: actualCostPerAnimal,
          notes: data.notes,
          appliedBy: userId,
          createdBy: userId
        }],
        session ? { session } : {}
      );

      // Bump every active animal in this pen by costPerAnimal.
      if (actualCostPerAnimal > 0) {
        await Animal.updateMany(
          { pen: pen._id, status: 'Active' },
          { $inc: { totalFeedCost: actualCostPerAnimal } },
          session ? { session } : {}
        );
      }

      createdApplications.push(created);
    }

    // Drop the paisa remainder on a random active animal across all selected
    // pens. Same reasoning as the single-pen path — avoids bias drift.
    if (actualRemainder > 0) {
      const picked = await sampleActiveAnimal(
        { pen: { $in: uniquePenIds } },
        session
      );
      if (picked) {
        await Animal.findByIdAndUpdate(
          picked._id,
          { $inc: { totalFeedCost: actualRemainder } },
          session ? { session } : {}
        );
      }
    }

    // Recipe counter ticks once per apply-action, regardless of pen count.
    await FeedRecipe.findByIdAndUpdate(
      recipe._id,
      { $inc: { appliedCount: 1 }, $set: { lastAppliedDate: new Date() } },
      session ? { session } : {}
    );

    return {
      applications: createdApplications,
      actualTotalCost,
      actualCostPerAnimal
    };
  });

  logAction({
    userId,
    action: 'Feed Recipe Applied',
    entityType: 'FeedApplication',
    entityId: result.applications[0]?._id,
    metadata: {
      recipeName: recipe.name,
      penCount: result.applications.length,
      penNames: result.applications.map(a => a.penName),
      totalAnimalCount,
      recipeEstimatedCostPerAnimal: recipe.totalCost,
      actualCostPerAnimal: result.actualCostPerAnimal,
      actualTotalCost: result.actualTotalCost
    }
  });

  // Back-compat: single-pen callers get back a single populated application.
  if (singlePenMode) {
    const app = result.applications[0];
    if (!app) {
      // No app was created (e.g. the only pen had 0 animals — caught above,
      // but defensive). Surface as a bad request so the client sees a real
      // error rather than a null body.
      throw ApiError.badRequest('No application created');
    }
    return app.populate(['recipe', 'pen', 'appliedBy']);
  }

  // Multi-pen callers get the full result, with each application populated.
  const populated = await Promise.all(
    result.applications.map(a => a.populate(['recipe', 'pen', 'appliedBy']))
  );
  return {
    applications: populated,
    totalCost: result.actualTotalCost,
    totalAnimalCount,
    costPerAnimal: result.actualCostPerAnimal
  };
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
  const { recipe, pen, pens, dateStart, dateEnd, notes } = data;

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

  // Pass either pen (single) or pens[] (multi) through to applyRecipe so the
  // range form supports the same multi-pen mode as the one-shot endpoint.
  const penPayload = Array.isArray(pens) && pens.length > 0
    ? { pens }
    : { pen };

  for (const date of dates) {
    try {
      const application = await applyRecipe(
        { recipe, ...penPayload, date, notes },
        userId
      );
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
