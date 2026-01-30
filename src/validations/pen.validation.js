const Joi = require('joi');
const { PEN_TYPES } = require('../constants');

const createPen = {
  body: Joi.object().keys({
    name: Joi.string().required().max(100).trim(),
    type: Joi.string().required().valid(...PEN_TYPES),
    capacity: Joi.number().required().integer().min(1),
    minWeightAvg: Joi.number().min(0).default(0),
    maxWeightAvg: Joi.number().min(0).default(100),
    description: Joi.string().max(500).allow('', null),
    location: Joi.string().trim().allow('', null)
  })
};

const updatePen = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  body: Joi.object().keys({
    name: Joi.string().max(100).trim(),
    type: Joi.string().valid(...PEN_TYPES),
    capacity: Joi.number().integer().min(1),
    minWeightAvg: Joi.number().min(0),
    maxWeightAvg: Joi.number().min(0),
    description: Joi.string().max(500).allow('', null),
    location: Joi.string().trim().allow('', null),
    isActive: Joi.boolean()
  }).min(1)
};

const getPens = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sort: Joi.string(),
    type: Joi.string().valid(...PEN_TYPES),
    isActive: Joi.boolean()
  })
};

module.exports = {
  createPen,
  updatePen,
  getPens
};
