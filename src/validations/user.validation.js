const Joi = require('joi');
const { USER_ROLES } = require('../constants');
const { STRONG_PASSWORD } = require('./password');

const createUser = {
  body: Joi.object().keys({
    name: Joi.string().required().min(2).max(100).trim(),
    email: Joi.string().required().email().lowercase().trim(),
    password: STRONG_PASSWORD.required(),
    role: Joi.string().required().valid(...USER_ROLES),
    phone: Joi.string().trim().allow('', null),
    employeeId: Joi.string().hex().length(24).allow(null)
  })
};

const resetPassword = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  body: Joi.object().keys({
    newPassword: STRONG_PASSWORD.required(),
    confirmPassword: Joi.string().required().valid(Joi.ref('newPassword'))
      .messages({ 'any.only': 'Passwords do not match' })
  })
};

module.exports = {
  createUser,
  resetPassword
};

