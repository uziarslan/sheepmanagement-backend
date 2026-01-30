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
  const animal = await animalService.update(req.params.id, req.body);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(animal, 'Animal updated successfully')
  );
});

/**
 * Delete animal
 * DELETE /api/animals/:id
 */
const remove = asyncHandler(async (req, res) => {
  await animalService.remove(req.params.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Animal deleted successfully')
  );
});

/**
 * Move animal to pen
 * PUT /api/animals/:id/move-to-pen
 */
const moveToPen = asyncHandler(async (req, res) => {
  const animal = await animalService.moveToPen(req.params.id, req.body.penId);
  
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

module.exports = {
  getAll,
  getById,
  create,
  bulkCreate,
  update,
  remove,
  moveToPen,
  getByPen
};
