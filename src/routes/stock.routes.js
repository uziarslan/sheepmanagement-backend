const express = require('express');
const router = express.Router();
const { stockController } = require('../controllers');
const { authenticate, validate } = require('../middleware');
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

// POST /api/stocks - Create stock
router.post(
  '/',
  validate(stockValidation.createStock),
  stockController.create
);

// PUT /api/stocks/:id - Update stock
router.put(
  '/:id',
  validate(stockValidation.updateStock),
  stockController.update
);

// POST /api/stocks/:id/adjust - Adjust stock quantity
router.post(
  '/:id/adjust',
  validate(stockValidation.adjustStock),
  stockController.adjustStock
);

// DELETE /api/stocks/:id - Delete stock
router.delete('/:id', stockController.remove);

module.exports = router;
