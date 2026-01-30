const express = require('express');
const router = express.Router();
const { employeeController } = require('../controllers');
const { authenticate, validate } = require('../middleware');
const { employeeValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// GET /api/employees/summary - Get employee summary
router.get('/summary', employeeController.getSummary);

// GET /api/employees/with-advances - Get employees with outstanding advances
router.get('/with-advances', employeeController.getWithAdvances);

// GET /api/employees - Get all employees
router.get(
  '/',
  validate(employeeValidation.getEmployees),
  employeeController.getAll
);

// GET /api/employees/:id - Get employee by ID
router.get('/:id', employeeController.getById);

// POST /api/employees - Create employee
router.post(
  '/',
  validate(employeeValidation.createEmployee),
  employeeController.create
);

// PUT /api/employees/:id - Update employee
router.put(
  '/:id',
  validate(employeeValidation.updateEmployee),
  employeeController.update
);

// DELETE /api/employees/:id - Delete employee
router.delete('/:id', employeeController.remove);

module.exports = router;
