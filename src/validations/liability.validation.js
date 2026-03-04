const Joi = require('joi');
const { LIABILITY_TYPES } = require('../constants');

const createLiability = {
  body: Joi.object().keys({
    lenderName: Joi.string().required().max(200).trim(),
    amount: Joi.number().required().min(1),
    type: Joi.string().required().valid(...LIABILITY_TYPES),
    date: Joi.date().default(Date.now),
    notes: Joi.string().max(500).allow('', null)
  })
};

const getLiabilities = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    sort: Joi.string(),
    lenderName: Joi.string(),
    type: Joi.string().valid(...LIABILITY_TYPES),
    startDate: Joi.date(),
    endDate: Joi.date()
  })
};

const getByLender = {
  params: Joi.object().keys({
    lenderName: Joi.string().required()
  })
};

module.exports = {
  createLiability,
  getLiabilities,
  getByLender
};
