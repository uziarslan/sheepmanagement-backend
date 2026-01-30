const express = require('express');
const router = express.Router();
const { advanceController } = require('../controllers');
const { authenticate, validate } = require('../middleware');
const { advanceValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// GET /api/advances/summary - Get advance summary
router.get('/summary', advanceController.getSummary);

// GET /api/advances/employee/:employeeId - Get advances by employee
router.get(
  '/employee/:employeeId',
  validate(advanceValidation.getByEmployee),
  advanceController.getByEmployee
);

// GET /api/advances - Get all advances
router.get(
  '/',
  validate(advanceValidation.getAdvances),
  advanceController.getAll
);

// POST /api/advances - Create advance
router.post(
  '/',
  validate(advanceValidation.createAdvance),
  advanceController.create
);

// DELETE /api/advances/:id - Delete advance
router.delete('/:id', advanceController.remove);

module.exports = router;
