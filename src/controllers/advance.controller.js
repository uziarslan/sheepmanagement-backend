const { advanceService } = require('../services');
const { asyncHandler, successResponse } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Get all advances
 * GET /api/advances
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await advanceService.getAll(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Advances retrieved successfully', result.meta)
  );
});

/**
 * Get advances by employee
 * GET /api/advances/employee/:employeeId
 */
const getByEmployee = asyncHandler(async (req, res) => {
  const advances = await advanceService.getByEmployee(req.params.employeeId);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(advances, 'Advances retrieved successfully')
  );
});

/**
 * Create advance
 * POST /api/advances
 */
const create = asyncHandler(async (req, res) => {
  const advance = await advanceService.create(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(advance, 'Advance recorded successfully')
  );
});

/**
 * Delete advance
 * DELETE /api/advances/:id
 */
const remove = asyncHandler(async (req, res) => {
  await advanceService.remove(req.params.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Advance record deleted successfully')
  );
});

/**
 * Get advance summary
 * GET /api/advances/summary
 */
const getSummary = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const summary = await advanceService.getSummary(startDate, endDate);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(summary, 'Advance summary retrieved successfully')
  );
});

module.exports = {
  getAll,
  getByEmployee,
  create,
  remove,
  getSummary
};
