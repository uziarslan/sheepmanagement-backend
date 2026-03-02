const Joi = require('joi');
const { CAPITAL_TRANSACTION_TYPES } = require('../constants');

const initializeCapital = {
  body: Joi.object().keys({
    amount: Joi.number().required().min(0)
  })
};

const addTransaction = {
  body: Joi.object().keys({
    amount: Joi.number().required(),
    type: Joi.string().required().valid(...CAPITAL_TRANSACTION_TYPES),
    description: Joi.string().max(500).allow('', null),
    reference: Joi.string().allow('', null)
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
