const { animalService } = require('../services');
const { asyncHandler, successResponse } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Get all animals
 * GET /api/animals
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await animalService.getAll(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Animals retrieved successfully', result.meta)
  );
});

/**
 * Get animal by ID
 * GET /api/animals/:id
 */
const getById = asyncHandler(async (req, res) => {
  const animal = await animalService.getById(req.params.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(animal, 'Animal retrieved successfully')
  );
});

/**
 * Create animal
 * POST /api/animals
 */
const create = asyncHandler(async (req, res) => {
  const animal = await animalService.create(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(animal, 'Animal created successfully')
  );
});

/**
 * Bulk create animals
 * POST /api/animals/bulk
 */
const bulkCreate = asyncHandler(async (req, res) => {
  const result = await animalService.bulkCreate(req.body.animals, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(result, 'Bulk upload completed')
  );
});

/**
 * Update animal
 * PUT /api/animals/:id
 */
const update = asyncHandler(async (req, res) => {
  const animal = await animalService.update(req.params.id, req.body, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(animal, 'Animal updated successfully')
  );
});

/**
 * Delete animal
 * DELETE /api/animals/:id
 */
const remove = asyncHandler(async (req, res) => {
  await animalService.remove(req.params.id, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Animal deleted successfully')
  );
});

/**
 * Move animal to pen
 * PUT /api/animals/:id/move-to-pen
 */
const moveToPen = asyncHandler(async (req, res) => {
  const animal = await animalService.moveToPen(req.params.id, req.body.penId, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(animal, 'Animal moved successfully')
  );
});

/**
 * Get animals by pen
 * GET /api/animals/pen/:penId
 */
const getByPen = asyncHandler(async (req, res) => {
  const animals = await animalService.getByPen(req.params.penId);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(animals, 'Animals retrieved successfully')
  );
});

/**
 * Bulk lookup animals by Tag IDs
 * POST /api/animals/by-tagids
 */
const getByTagIds = asyncHandler(async (req, res) => {
  const animals = await animalService.getByTagIds(req.body.tagIds);

  res.status(HTTP_STATUS.OK).json(
    successResponse(animals, 'Animals retrieved successfully')
  );
});

/**
 * Declare animal as dead
 * PUT /api/animals/:id/declare-dead
 */
const declareDead = asyncHandler(async (req, res) => {
  const result = await animalService.declareDead(req.params.id, req.body, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result, 'Animal marked as dead; loss recorded in capital')
  );
});

/**
 * Mark animal as sold
 * PUT /api/animals/:id/mark-sold
 */
const markAsSold = asyncHandler(async (req, res) => {
  const result = await animalService.markAsSold(req.params.id, req.body, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result, 'Animal marked as sold successfully')
  );
});

/**
 * Bulk mark animals as sold
 * POST /api/animals/bulk-mark-sold
 */
const bulkMarkAsSold = asyncHandler(async (req, res) => {
  const result = await animalService.bulkMarkAsSold(req.body.animals, req.user.id);

  res.status(HTTP_STATUS.OK).json(
    successResponse(result, 'Bulk sale processing completed')
  );
});

/**
 * Recalculate animal costs (Admin only)
 * POST /api/animals/:id/recalculate-costs
 */
const recalculateAnimalCosts = asyncHandler(async (req, res) => {
  const animal = await animalService.recalculateCosts(req.params.id);

  res.status(HTTP_STATUS.OK).json(
    successResponse(animal, 'Animal cost fields validated (negative values clamped to 0)')
  );
});

/**
 * Restore an animal from Dead status (undo declare-dead).
 * PUT /api/animals/:id/restore-from-dead
 */
const restoreFromDead = asyncHandler(async (req, res) => {
  const result = await animalService.restoreFromDead(req.params.id, req.user.id);

  res.status(HTTP_STATUS.OK).json(
    successResponse(result, 'Animal restored from Dead status; capital loss reversed')
  );
});

/**
 * Restore an animal from Sold status (undo mark-sold).
 * PUT /api/animals/:id/restore-from-sold
 */
const restoreFromSold = asyncHandler(async (req, res) => {
  const result = await animalService.restoreFromSold(req.params.id, req.user.id);

  res.status(HTTP_STATUS.OK).json(
    successResponse(result, 'Animal restored from Sold status; capital sale reversed')
  );
});

module.exports = {
  getAll,
  getById,
  create,
  bulkCreate,
  update,
  remove,
  moveToPen,
  getByPen,
  getByTagIds,
  declareDead,
  markAsSold,
  bulkMarkAsSold,
  restoreFromDead,
  restoreFromSold,
  recalculateAnimalCosts
};
