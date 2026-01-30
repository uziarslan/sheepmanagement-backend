const Joi = require('joi');
const { ApiError } = require('../utils');

/**
 * Validation middleware factory
 * @param {Object} schema - Joi validation schema
 * @returns {Function} Express middleware function
 */
const validate = (schema) => (req, res, next) => {
  // Pick only the parts we want to validate
  const validSchema = {};
  const requestData = {};

  ['params', 'query', 'body'].forEach((key) => {
    if (schema[key]) {
      validSchema[key] = schema[key];
      requestData[key] = req[key];
    }
  });

  // Validate
  const { value, error } = Joi.compile(validSchema)
    .prefs({ errors: { label: 'key' }, abortEarly: false })
    .validate(requestData);

  if (error) {
    const errorMessage = error.details
      .map((detail) => detail.message)
      .join(', ');
    return next(ApiError.badRequest(errorMessage));
  }

  // Assign validated values back to request
  Object.assign(req, value);
  return next();
};

module.exports = validate;
