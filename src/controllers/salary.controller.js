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

  res.status(HTTP_STATUS.CREATED).json(
    successResponse(payment, 'Salary paid successfully')
  );

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
});

module.exports = {
  getSalaryPayments,
  createSalaryPayment
};

