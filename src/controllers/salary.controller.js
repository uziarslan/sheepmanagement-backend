const { salaryService } = require('../services');
const { asyncHandler, successResponse, logAction } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Get salary payments
 * GET /api/salaries
 */
const getSalaryPayments = asyncHandler(async (req, res) => {
  const result = await salaryService.getSalaryPayments(req.query);

  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Salary payments retrieved successfully', {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages
    })
  );
});

/**
 * Create salary payment
 * POST /api/salaries
 */
const createSalaryPayment = asyncHandler(async (req, res) => {
  const payment = await salaryService.createSalaryPayment(req.body, req.user.id);

  logAction({
    req,
    action: 'CREATE_SALARY_PAYMENT',
    entityType: 'SalaryPayment',
    entityId: payment.id,
    metadata: {
      employee: payment.employee,
      amount: payment.amount,
      month: payment.month,
      year: payment.year
    }
  });

  res.status(HTTP_STATUS.CREATED).json(
    successResponse(payment, 'Salary paid successfully')
  );
});

/**
 * Reverse a salary payment (Admin only).
 * DELETE /api/salaries/:id
 */
const reverseSalaryPayment = asyncHandler(async (req, res) => {
  const payment = await salaryService.reverseSalaryPayment(req.params.id, req.user.id);

  logAction({
    req,
    action: 'REVERSE_SALARY_PAYMENT',
    entityType: 'SalaryPayment',
    entityId: payment._id,
    metadata: {
      employee: payment.employee,
      month: payment.month,
      year: payment.year,
      netSalary: payment.netSalary,
      advanceDeduction: payment.advanceDeduction
    }
  });

  res.status(HTTP_STATUS.OK).json(
    successResponse(payment, 'Salary payment reversed; capital, advance, and animal costs restored')
  );
});

module.exports = {
  getSalaryPayments,
  createSalaryPayment,
  reverseSalaryPayment
};

