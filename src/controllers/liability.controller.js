const { liabilityService } = require('../services');
const { asyncHandler, successResponse } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Get all liabilities
 * GET /api/liabilities
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await liabilityService.getAll(req.query, req.user.id);

  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Liabilities retrieved successfully', result.meta)
  );
});

/**
 * Get liabilities by lender
 * GET /api/liabilities/lender/:lenderName
 */
const getByLender = asyncHandler(async (req, res) => {
  const liabilities = await liabilityService.getByLender(req.params.lenderName, req.user.id);

  res.status(HTTP_STATUS.OK).json(
    successResponse(liabilities, 'Liabilities retrieved successfully')
  );
});

/**
 * Create liability
 * POST /api/liabilities
 */
const create = asyncHandler(async (req, res) => {
  const liability = await liabilityService.create(req.body, req.user.id);

  res.status(HTTP_STATUS.CREATED).json(
    successResponse(liability, 'Liability recorded successfully')
  );
});

/**
 * Delete liability
 * DELETE /api/liabilities/:id
 */
const remove = asyncHandler(async (req, res) => {
  await liabilityService.remove(req.params.id, req.user.id);

  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Liability record deleted successfully')
  );
});

/**
 * Get liability summary
 * GET /api/liabilities/summary
 */
const getSummary = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const summary = await liabilityService.getSummary(req.user.id, startDate, endDate);

  res.status(HTTP_STATUS.OK).json(
    successResponse(summary, 'Liability summary retrieved successfully')
  );
});

module.exports = {
  getAll,
  getByLender,
  create,
  remove,
  getSummary
};
