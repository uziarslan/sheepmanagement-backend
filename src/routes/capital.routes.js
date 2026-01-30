const express = require('express');
const router = express.Router();
const { capitalController } = require('../controllers');
const { authenticate, validate } = require('../middleware');
const { capitalValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// GET /api/capital/summary - Get capital summary
router.get('/summary', capitalController.getSummary);

// GET /api/capital/transactions - Get transactions
router.get(
  '/transactions',
  validate(capitalValidation.getTransactions),
  capitalController.getTransactions
);

// GET /api/capital - Get capital info
router.get('/', capitalController.get);

// POST /api/capital/initialize - Initialize capital
router.post(
  '/initialize',
  validate(capitalValidation.initializeCapital),
  capitalController.initialize
);

// PUT /api/capital - Add transaction
router.put(
  '/',
  validate(capitalValidation.addTransaction),
  capitalController.addTransaction
);

module.exports = router;
