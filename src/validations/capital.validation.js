const Joi = require('joi');
const { CAPITAL_TRANSACTION_TYPES, INVESTMENT_SUBTYPES } = require('../constants');

const initializeCapital = {
  body: Joi.object().keys({
    partner1: Joi.number().min(0).default(0),
    partner2: Joi.number().min(0).default(0),
    retainedEarnings: Joi.number().min(0).default(0)
  }).custom((value, helpers) => {
    const total = (value.partner1 || 0) + (value.partner2 || 0) + (value.retainedEarnings || 0);
    if (total <= 0) {
      return helpers.error('any.invalid');
    }
    return value;
  }).messages({
    'any.invalid': 'At least one of partner1, partner2, or retainedEarnings must be greater than 0'
  })
};

const addTransaction = {
  body: Joi.object().keys({
    amount: Joi.number().required(),
    type: Joi.string().required().valid(...CAPITAL_TRANSACTION_TYPES),
    description: Joi.string().max(500).allow('', null),
    reference: Joi.string().allow('', null),
    investmentSubtype: Joi.string().valid(...INVESTMENT_SUBTYPES).allow(null, '')
  })
};

const getTransactions = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    type: Joi.string().valid(...CAPITAL_TRANSACTION_TYPES),
    startDate: Joi.date(),
    endDate: Joi.date()
  })
};

// For file upload - only validate transactionId param (file validated by multer)
const uploadTransactionInvoice = {
  params: Joi.object().keys({
    transactionId: Joi.string().hex().length(24).required()
  })
};

module.exports = {
  initializeCapital,
  addTransaction,
  getTransactions,
  uploadTransactionInvoice
};
