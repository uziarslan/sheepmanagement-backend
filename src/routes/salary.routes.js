const express = require('express');
const router = express.Router();
const { salaryController } = require('../controllers');
const { authenticate, authorize, validate } = require('../middleware');
const { salaryValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// GET /api/salaries - Get salary payments
router.get(
  '/',
  validate(salaryValidation.getSalaryPayments),
  salaryController.getSalaryPayments
);

// POST /api/salaries - Create salary payment (Admin only)
router.post(
  '/',
  authorize('Admin'),
  validate(salaryValidation.createSalaryPayment),
  salaryController.createSalaryPayment
);

module.exports = router;

