const express = require('express');
const router = express.Router();
const { stockController } = require('../controllers');
const { authenticate, authorize, validate, idempotency } = require('../middleware');
const { stockValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// GET /api/stocks/summary - Get stock summary
router.get('/summary', stockController.getSummary);

// GET /api/stocks/low-stock - Get low stock items
router.get('/low-stock', stockController.getLowStock);

// GET /api/stocks/category/:category - Get stocks by category
router.get('/category/:category', stockController.getByCategory);

// GET /api/stocks - Get all stocks
router.get(
  '/',
  validate(stockValidation.getStocks),
  stockController.getAll
);

// GET /api/stocks/:id - Get stock by ID
router.get('/:id', stockController.getById);

// POST /api/stocks - Create stock (Admin, Manager — deducts capital)
router.post(
  '/',
  authorize('Admin', 'Manager'),
  idempotency,
  validate(stockValidation.createStock),
  stockController.create
);

// PUT /api/stocks/:id - Update stock (Admin, Manager — re-syncs capital)
router.put(
  '/:id',
  authorize('Admin', 'Manager'),
  validate(stockValidation.updateStock),
  stockController.update
);

// POST /api/stocks/:id/adjust - Adjust stock quantity (Admin, Manager — affects capital)
router.post(
  '/:id/adjust',
  authorize('Admin', 'Manager'),
  idempotency,
  validate(stockValidation.adjustStock),
  stockController.adjustStock
);

// DELETE /api/stocks/:id - Delete stock (Admin only — refunds capital)
router.delete('/:id', authorize('Admin'), stockController.remove);

module.exports = router;
