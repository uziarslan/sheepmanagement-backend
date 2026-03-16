const { feedService } = require('../services');
const { asyncHandler, successResponse } = require('../utils');
const { HTTP_STATUS } = require('../constants');

// ============ RECIPE CONTROLLERS ============

/**
 * Get all recipes
 * GET /api/feed/recipes
 */
const getAllRecipes = asyncHandler(async (req, res) => {
  const result = await feedService.getAllRecipes(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Recipes retrieved successfully', result.meta)
  );
});

/**
 * Get recipe by ID
 * GET /api/feed/recipes/:id
 */
const getRecipeById = asyncHandler(async (req, res) => {
  const recipe = await feedService.getRecipeById(req.params.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(recipe, 'Recipe retrieved successfully')
  );
});

/**
 * Create recipe
 * POST /api/feed/recipes
 */
const createRecipe = asyncHandler(async (req, res) => {
  const recipe = await feedService.createRecipe(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(recipe, 'Recipe created successfully')
  );
});

/**
 * Update recipe
 * PUT /api/feed/recipes/:id
 */
const updateRecipe = asyncHandler(async (req, res) => {
  const recipe = await feedService.updateRecipe(req.params.id, req.body, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(recipe, 'Recipe updated successfully')
  );
});

/**
 * Delete recipe
 * DELETE /api/feed/recipes/:id
 */
const deleteRecipe = asyncHandler(async (req, res) => {
  await feedService.deleteRecipe(req.params.id, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Recipe deleted successfully')
  );
});

// ============ APPLICATION CONTROLLERS ============

/**
 * Get all applications
 * GET /api/feed/applications
 */
const getApplications = asyncHandler(async (req, res) => {
  const result = await feedService.getApplications(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Applications retrieved successfully', result.meta)
  );
});

/**
 * Apply recipe
 * POST /api/feed/applications
 */
const applyRecipe = asyncHandler(async (req, res) => {
  const application = await feedService.applyRecipe(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(application, 'Recipe applied successfully')
  );
});

/**
 * Apply recipe over a date range (P3-09 / F-57)
 * POST /api/feed/applications/range
 */
const applyRecipeRange = asyncHandler(async (req, res) => {
  const result = await feedService.applyRecipeRange(req.body, req.user.id);

  res.status(HTTP_STATUS.OK).json(
    successResponse(result, `Recipe applied for ${result.succeeded.length} day(s)`)
  );
});

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
