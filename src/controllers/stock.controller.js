const { stockService } = require('../services');
const { asyncHandler, successResponse } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Get all stocks
 * GET /api/stocks
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await stockService.getAll(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Stocks retrieved successfully', result.meta)
  );
});

/**
 * Get stock by ID
 * GET /api/stocks/:id
 */
const getById = asyncHandler(async (req, res) => {
  const stock = await stockService.getById(req.params.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(stock, 'Stock retrieved successfully')
  );
});

/**
 * Create stock
 * POST /api/stocks
 */
const create = asyncHandler(async (req, res) => {
  const stock = await stockService.create(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(stock, 'Stock item created successfully')
  );
});

/**
 * Update stock
 * PUT /api/stocks/:id
 */
const update = asyncHandler(async (req, res) => {
  const stock = await stockService.update(req.params.id, req.body);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(stock, 'Stock updated successfully')
  );
});

/**
 * Delete stock
 * DELETE /api/stocks/:id
 */
const remove = asyncHandler(async (req, res) => {
  await stockService.remove(req.params.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Stock item deleted successfully')
  );
});

/**
 * Adjust stock quantity
 * POST /api/stocks/:id/adjust
 */
const adjustStock = asyncHandler(async (req, res) => {
  const { quantity, type, reason } = req.body;
  const stock = await stockService.adjustStock(req.params.id, quantity, type, reason);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(stock, 'Stock adjusted successfully')
  );
});

/**
 * Get low stock items
 * GET /api/stocks/low-stock
 */
const getLowStock = asyncHandler(async (req, res) => {
  const stocks = await stockService.getLowStockItems();
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(stocks, 'Low stock items retrieved successfully')
  );
});

/**
 * Get stock by category
 * GET /api/stocks/category/:category
 */
const getByCategory = asyncHandler(async (req, res) => {
  const stocks = await stockService.getByCategory(req.params.category);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(stocks, 'Stocks retrieved successfully')
  );
});

/**
 * Get stock summary
 * GET /api/stocks/summary
 */
const getSummary = asyncHandler(async (req, res) => {
  const summary = await stockService.getSummary();
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(summary, 'Stock summary retrieved successfully')
  );
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  adjustStock,
  getLowStock,
  getByCategory,
  getSummary
};
