const { penService } = require('../services');
const { asyncHandler, successResponse } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Get all pens
 * GET /api/pens
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await penService.getAll(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Pens retrieved successfully', result.meta)
  );
});

/**
 * Get pen by ID
 * GET /api/pens/:id
 */
const getById = asyncHandler(async (req, res) => {
  const pen = await penService.getById(req.params.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(pen, 'Pen retrieved successfully')
  );
});

/**
 * Create pen
 * POST /api/pens
 */
const create = asyncHandler(async (req, res) => {
  const pen = await penService.create(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(pen, 'Pen created successfully')
  );
});

/**
 * Update pen
 * PUT /api/pens/:id
 */
const update = asyncHandler(async (req, res) => {
  const pen = await penService.update(req.params.id, req.body, req.user.id);

  res.status(HTTP_STATUS.OK).json(
    successResponse(pen, 'Pen updated successfully')
  );
});

/**
 * Delete pen
 * DELETE /api/pens/:id
 */
const remove = asyncHandler(async (req, res) => {
  await penService.remove(req.params.id, req.user.id);

  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Pen deleted successfully')
  );
});

/**
 * Get pen statistics
 * GET /api/pens/stats
 */
const getStats = asyncHandler(async (req, res) => {
  const stats = await penService.getStats();
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(stats, 'Pen statistics retrieved successfully')
  );
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  getStats
};
