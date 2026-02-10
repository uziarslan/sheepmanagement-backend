const Joi = require('joi');

const createSalaryPayment = {
  body: Joi.object().keys({
    employee: Joi.string().hex().length(24).required(),
    month: Joi.number().integer().min(1).max(12).required(),
    year: Joi.number().integer().min(2000).required(),
    paymentDate: Joi.date(),
    paymentMode: Joi.string().valid('Cash', 'Bank Transfer', 'Cheque', 'Other').default('Cash'),
    advanceDeduction: Joi.number().min(0).default(0),
    otherDeductions: Joi.number().min(0).default(0),
    notes: Joi.string().allow('', null)
  })
};

const getSalaryPayments = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    employee: Joi.string().hex().length(24),
    month: Joi.number().integer().min(1).max(12),
    year: Joi.number().integer().min(2000),
    sort: Joi.string()
  })
};

module.exports = {
  createSalaryPayment,
  getSalaryPayments
};

