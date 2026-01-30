const Joi = require('joi');

const register = {
  body: Joi.object().keys({
    name: Joi.string().required().min(2).max(100).trim(),
    email: Joi.string().required().email().lowercase().trim(),
    password: Joi.string().required().min(6).max(128),
    confirmPassword: Joi.string().required().valid(Joi.ref('password'))
      .messages({ 'any.only': 'Passwords do not match' }),
    farmName: Joi.string().max(200).trim(),
    phone: Joi.string().trim()
  })
};

const login = {
  body: Joi.object().keys({
    email: Joi.string().required().email().lowercase().trim(),
    password: Joi.string().required()
  })
};

const refreshToken = {
  body: Joi.object().keys({
    refreshToken: Joi.string().required()
  })
};

const changePassword = {
  body: Joi.object().keys({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().required().min(6).max(128),
    confirmPassword: Joi.string().required().valid(Joi.ref('newPassword'))
      .messages({ 'any.only': 'Passwords do not match' })
  })
};

const updateProfile = {
  body: Joi.object().keys({
    name: Joi.string().min(2).max(100).trim(),
    farmName: Joi.string().max(200).trim(),
    phone: Joi.string().trim()
  })
};

module.exports = {
  register,
  login,
  refreshToken,
  changePassword,
  updateProfile
};
