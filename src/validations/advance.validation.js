const Joi = require('joi');
const { ADVANCE_TYPES } = require('../constants');

const createAdvance = {
  body: Joi.object().keys({
    employee: Joi.string().hex().length(24).required(),
    amount: Joi.number().required().min(1),
    type: Joi.string().required().valid(...ADVANCE_TYPES),
    date: Joi.date().default(Date.now),
    notes: Joi.string().max(500).allow('', null)
  })
};

const getAdvances = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    sort: Joi.string(),
    employee: Joi.string().hex().length(24),
    type: Joi.string().valid(...ADVANCE_TYPES),
    startDate: Joi.date(),
    endDate: Joi.date()
  })
};

const getByEmployee = {
  params: Joi.object().keys({
    employeeId: Joi.string().hex().length(24).required()
  })
};

module.exports = {
  createAdvance,
  getAdvances,
  getByEmployee
};
