const { employeeService } = require('../services');
const { asyncHandler, successResponse, logAction } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Get all employees
 * GET /api/employees
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await employeeService.getAll(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Employees retrieved successfully', result.meta)
  );
});

/**
 * Get employee by ID
 * GET /api/employees/:id
 */
const getById = asyncHandler(async (req, res) => {
  const employee = await employeeService.getById(req.params.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(employee, 'Employee retrieved successfully')
  );
});

/**
 * Create employee
 * POST /api/employees
 */
const create = asyncHandler(async (req, res) => {
  const employee = await employeeService.create(req.body, req.user.id);

  logAction({
    req,
    action: 'CREATE_EMPLOYEE',
    entityType: 'Employee',
    entityId: employee.id,
    metadata: {
      name: employee.name,
      cnic: employee.cnic,
      department: employee.department,
      designation: employee.designation,
      createdBy: req.user.id
    }
  });

  res.status(HTTP_STATUS.CREATED).json(
    successResponse(employee, 'Employee created successfully')
  );
});

/**
 * Update employee
 * PUT /api/employees/:id
 */
const update = asyncHandler(async (req, res) => {
  // Pass userId so the service-side audit entry has a structured diff
  // attributed to the right user (Sprint 5 — AL3).
  const employee = await employeeService.update(req.params.id, req.body, req.user.id);

  res.status(HTTP_STATUS.OK).json(
    successResponse(employee, 'Employee updated successfully')
  );
});

/**
 * Delete employee
 * DELETE /api/employees/:id
 */
const remove = asyncHandler(async (req, res) => {
  await employeeService.remove(req.params.id);

  logAction({
    req,
    action: 'DELETE_EMPLOYEE',
    entityType: 'Employee',
    entityId: req.params.id
  });

  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Employee deleted successfully')
  );
});

/**
 * Separate an employee — resign / terminate / retire / mark inactive.
 * PATCH /api/employees/:id/separate
 */
const separate = asyncHandler(async (req, res) => {
  const employee = await employeeService.separateEmployee(
    req.params.id,
    req.body,
    req.user.id
  );

  res.status(HTTP_STATUS.OK).json(
    successResponse(employee, `Employee marked as ${employee.status}`)
  );
});

/**
 * Reactivate a separated employee.
 * PATCH /api/employees/:id/reactivate
 */
const reactivate = asyncHandler(async (req, res) => {
  const employee = await employeeService.reactivateEmployee(
    req.params.id,
    req.user.id
  );

  res.status(HTTP_STATUS.OK).json(
    successResponse(employee, 'Employee reactivated successfully')
  );
});

/**
 * Reset employee login password (Admin-only)
 * PATCH /api/employees/:id/reset-password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  await employeeService.resetEmployeePassword(req.params.id, newPassword);

  logAction({
    req,
    action: 'RESET_EMPLOYEE_PASSWORD',
    entityType: 'Employee',
    entityId: req.params.id
  });

  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Employee password reset successfully')
  );
});

/**
 * Get employees with outstanding advances
 * GET /api/employees/with-advances
 */
const getWithAdvances = asyncHandler(async (req, res) => {
  const employees = await employeeService.getWithOutstandingAdvances();
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(employees, 'Employees retrieved successfully')
  );
});

/**
 * Get employee summary
 * GET /api/employees/summary
 */
const getSummary = asyncHandler(async (req, res) => {
  const summary = await employeeService.getSummary();
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(summary, 'Employee summary retrieved successfully')
  );
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  getWithAdvances,
  getSummary,
  resetPassword,
  separate,
  reactivate
};
