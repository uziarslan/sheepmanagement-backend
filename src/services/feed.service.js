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
 * Internal batched apply: one FIFO sweep covers ALL (date × pen) combinations,
 * then a single insertMany creates the per-day-per-pen FeedApplication
 * records. Heroku gives us 30s per request, and the old per-day loop blew
 * that budget (each day was its own transaction). Batching makes 60-day
 * applies finish in a few seconds.
 *
 * @param {string} recipeId
 * @param {string[]} penIds       deduped already by caller
 * @param {Date[]} dates          one entry per application day (inclusive)
 * @param {string?} notes
 * @param {string} userId
 * @returns {{applications: object[], actualTotalCost: number, actualCostPerAnimalPerDay: number, penAnimalCounts: object, totalAnimalCount: number}}
 */
const _applyRecipeBatch = async (recipeId, penIds, dates, notes, userId) => {
  if (!Array.isArray(dates) || dates.length === 0) {
    throw ApiError.badRequest('At least one application date is required');
  }
  if (!Array.isArray(penIds) || penIds.length === 0) {
    throw ApiError.badRequest('At least one pen is required');
  }

  const recipe = await FeedRecipe.findById(recipeId);
  if (!recipe) throw ApiError.notFound('Recipe not found');

  // De-dupe pen IDs (a UI bug shouldn't get the same pen charged twice).
  const uniquePenIds = [...new Set(penIds.map(String))];

  // Load all pens up-front so a bad ID errors out before stock is touched.
  const pens = await Pen.find({ _id: { $in: uniquePenIds } });
  if (pens.length !== uniquePenIds.length) {
    throw ApiError.notFound('One or more pens not found');
  }
  const pensById = Object.fromEntries(pens.map(p => [String(p._id), p]));

  // Snapshot active animal counts per pen (one aggregate, not N round-trips).
  const countAgg = await Animal.aggregate([
    { $match: { pen: { $in: pens.map(p => p._id) }, status: 'Active' } },
    { $group: { _id: '$pen', count: { $sum: 1 } } }
  ]);
  const penAnimalCounts = {};
  let totalAnimalCount = 0;
  for (const id of uniquePenIds) {
    const row = countAgg.find(r => String(r._id) === id);
    const c = row ? row.count : 0;
    penAnimalCounts[id] = c;
    totalAnimalCount += c;
  }

  if (totalAnimalCount === 0) {
    throw ApiError.badRequest(
      'No active animals in the selected pen(s); nothing to apply against.'
    );
  }

  const dayCount = dates.length;

  const result = await withTransaction(async (session) => {
    // ── ONE FIFO sweep for the full combined need ────────────────────────
    // For each ingredient: deduct ing.quantity × totalAnimalCount × dayCount
    // (recipe is per-animal-per-day; we're applying for D days across all
    // selected pens). The cost is settled against actual batch rates so a
    // mid-life stock price edit is handled (Sprint 3 F4/S6).
    const ingredientCostBreakdown = [];
    let actualTotalCostAllDays = 0;

    for (const ing of recipe.ingredients) {
      const perAnimalQty = Number(ing.quantity) || 0;
      const totalQtyNeeded = perAnimalQty * totalAnimalCount * dayCount;
      if (totalQtyNeeded <= 0) continue;

      const refStock = await Stock.findById(ing.stock).session(session || null);
      if (!refStock) {
        throw ApiError.notFound(`Stock item "${ing.name}" not found`);
      }

      const matchingStocks = await Stock.find({
        productName: { $regex: new RegExp(`^${ing.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        category: refStock.category
      })
        .sort({ purchaseDate: 1, createdAt: 1 })
        .session(session || null);

      const totalAvailable = matchingStocks.reduce((s, st) => s + (st.currentQty || 0), 0);
      if (totalAvailable < totalQtyNeeded) {
        throw ApiError.badRequest(
          `Insufficient stock for ${ing.name}. Total available: ${totalAvailable} ${ing.unit}, ` +
          `needed: ${totalQtyNeeded} ${ing.unit} (${perAnimalQty} × ${totalAnimalCount} animal${totalAnimalCount > 1 ? 's' : ''}` +
          (dayCount > 1 ? ` × ${dayCount} days` : '') + `)`
        );
      }

      let remaining = totalQtyNeeded;
      let ingActualCost = 0;

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
        ingActualCost += deductQty * batchRate;
        remaining -= deductQty;
      }

      if (remaining > 0) {
        throw ApiError.badRequest(
          `Could not fully deduct ${totalQtyNeeded} ${ing.unit} of ${ing.name} (concurrent contention).`
        );
      }

      actualTotalCostAllDays += ingActualCost;
      ingredientCostBreakdown.push({
        stock: ing.stock,
        name: ing.name,
        unit: ing.unit,
        perAnimalQuantity: perAnimalQty,
        // Weighted-average actual rate paid across the FIFO batches.
        rate: totalQtyNeeded > 0 ? ingActualCost / totalQtyNeeded : (ing.ratePerUnit || 0)
      });
    }

    // Per-animal-per-day cost from ACTUAL spend.
    const actualCostPerAnimalPerDay = totalAnimalCount > 0 && dayCount > 0
      ? Math.floor(actualTotalCostAllDays * 100 / (totalAnimalCount * dayCount)) / 100
      : 0;
    const allocated = actualCostPerAnimalPerDay * totalAnimalCount * dayCount;
    const actualRemainder = Math.round((actualTotalCostAllDays - allocated) * 100) / 100;

    // ── Bulk insert one FeedApplication per (date × pen) ─────────────────
    const docsToInsert = [];
    for (const penId of uniquePenIds) {
      const pen = pensById[penId];
      const count = penAnimalCounts[penId];
      if (count === 0) continue;

      const penIngredients = ingredientCostBreakdown.map(b => {
        const penDayQty = b.perAnimalQuantity * count;
        return {
          stock: b.stock,
          name: b.name,
          unit: b.unit,
          quantity: penDayQty,
          rate: b.rate,
          total: penDayQty * b.rate
        };
      });

      const penDayCost = Math.round(actualCostPerAnimalPerDay * count * 100) / 100;

      for (const date of dates) {
        docsToInsert.push({
          recipe: recipe._id,
          recipeName: recipe.name,
          pen: pen._id,
          penName: pen.name,
          date,
          animalCount: count,
          ingredients: penIngredients,
          totalCost: penDayCost,
          costPerAnimal: actualCostPerAnimalPerDay,
          notes,
          appliedBy: userId,
          createdBy: userId
        });
      }
    }

    const insertedApps = docsToInsert.length > 0
      ? await FeedApplication.insertMany(
          docsToInsert,
          session ? { session, ordered: true } : { ordered: true }
        )
      : [];

    // ── Bump each pen's animals' totalFeedCost by (per-day × dayCount) ──
    // One updateMany per pen instead of one per (date × pen). Significant
    // win for date-range applies.
    if (actualCostPerAnimalPerDay > 0) {
      const perAnimalRangeCost =
        Math.round(actualCostPerAnimalPerDay * dayCount * 100) / 100;
      for (const penId of uniquePenIds) {
        if (penAnimalCounts[penId] === 0) continue;
        await Animal.updateMany(
          { pen: penId, status: 'Active' },
          { $inc: { totalFeedCost: perAnimalRangeCost } },
          session ? { session } : {}
        );
      }
    }

    // Paisa remainder lands on one random active animal across all pens
    // (X4 — symmetric with the single-day path; prevents bias drift).
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

    // Recipe counter ticks once per FeedApplication record created — matches
    // the old per-day behaviour so the "Applied N times" badge stays
    // consistent with what users see.
    if (insertedApps.length > 0) {
      await FeedRecipe.findByIdAndUpdate(
        recipe._id,
        {
          $inc: { appliedCount: insertedApps.length },
          $set: { lastAppliedDate: dates[dates.length - 1] }
        },
        session ? { session } : {}
      );
    }

    return {
      applications: insertedApps,
      actualTotalCost: actualTotalCostAllDays,
      actualCostPerAnimalPerDay
    };
  });

  logAction({
    userId,
    action: 'Feed Recipe Applied',
    entityType: 'FeedApplication',
    entityId: result.applications[0]?._id,
    metadata: {
      recipeName: recipe.name,
      penCount: uniquePenIds.length,
      penNames: pens.map(p => p.name),
      dayCount,
      totalAnimalCount,
      recipeEstimatedCostPerAnimal: recipe.totalCost,
      actualCostPerAnimalPerDay: result.actualCostPerAnimalPerDay,
      actualTotalCost: result.actualTotalCost
    }
  });

  return {
    ...result,
    penAnimalCounts,
    totalAnimalCount
  };
};

/**
 * Apply a recipe to one or more pens for a single date.
 *
 * Recipe quantities and cost are PER ANIMAL. Apply-time:
 *   - Deduct `ingredient.quantity × totalAnimalCount` via FIFO.
 *   - costPerAnimal settled from actual FIFO spend.
 *   - One FeedApplication record per pen.
 *
 * Accepts:
 *   - { pen: <id>, ... }       → single-pen apply (back-compat)
 *   - { pens: [<id>, ...] }    → multi-pen apply
 *
 * Returns:
 *   - single-pen mode  → the created FeedApplication (back-compat shape)
 *   - multi-pen mode   → { applications: [...], totalCost, totalAnimalCount }
 */
const applyRecipe = async (data, userId) => {
  // Normalize pen → pens[]. Track whether the caller used single-pen mode so
  // we can return the legacy single-application shape unchanged.
  const singlePenMode = !Array.isArray(data.pens);
  const penIds = singlePenMode
    ? [data.pen]
    : data.pens;

  if (!penIds || penIds.length === 0) {
    throw ApiError.badRequest('At least one pen is required');
  }

  const date = data.date ? new Date(data.date) : new Date();

  const batch = await _applyRecipeBatch(
    data.recipe,
    penIds,
    [date],
    data.notes,
    userId
  );

  // Populate refs for the response.
  const populated = await Promise.all(
    batch.applications.map(a => a.populate(['recipe', 'pen', 'appliedBy']))
  );

  // Back-compat: single-pen callers get the single populated application.
  if (singlePenMode) {
    if (!populated[0]) {
      throw ApiError.badRequest('No application created');
    }
    return populated[0];
  }

  return {
    applications: populated,
    totalCost: batch.actualTotalCost,
    totalAnimalCount: batch.totalAnimalCount,
    costPerAnimal: batch.actualCostPerAnimalPerDay
  };
};

/**
 * Apply a recipe across a date range to one or more pens.
 *
 * Previously this looped over each day and called `applyRecipe` once per day.
 * That meant N transactions and N FIFO sweeps; on Heroku, a 60-day range
 * routinely blew past the 30s request timeout (H12). This now does the entire
 * range in ONE transaction with ONE FIFO sweep over the combined quantity
 * (qty × totalAnimals × dayCount), then bulk-inserts the per-day-per-pen
 * application records.
 *
 * Trade-off: the old implementation could partially succeed (some days ok,
 * some failed). The new one is atomic — either all days commit or none. This
 * is actually the desired property: a half-applied range is hard to reason
 * about and clean up.
 *
 * @param {{ recipe, pen, pens, dateStart, dateEnd, notes }} data
 * @returns {{ succeeded: object[], failed: object[] }}  shape kept for client
 */
const applyRecipeRange = async (data, userId) => {
  const { recipe, pen, pens, dateStart, dateEnd, notes } = data;

  // Build the dates list inclusive, capped at 90.
  const start = new Date(dateStart);
  const end   = new Date(dateEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw ApiError.badRequest('Invalid dateStart or dateEnd');
  }
  if (end < start) {
    throw ApiError.badRequest('dateEnd must be on or after dateStart');
  }
  const MAX_DAYS = 90;
  const dates = [];
  for (
    let d = new Date(start);
    d <= end && dates.length < MAX_DAYS;
    d.setDate(d.getDate() + 1)
  ) {
    dates.push(new Date(d));
  }

  const penIds = Array.isArray(pens) && pens.length > 0 ? pens : [pen];

  const batch = await _applyRecipeBatch(recipe, penIds, dates, notes, userId);

  // Keep the legacy { succeeded, failed } envelope — the frontend already
  // unpacks `succeeded` as a flat list of application records.
  return {
    succeeded: batch.applications,
    failed: [],
    totalCost: batch.actualTotalCost,
    totalAnimalCount: batch.totalAnimalCount,
    costPerAnimalPerDay: batch.actualCostPerAnimalPerDay,
    dayCount: dates.length
  };
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
