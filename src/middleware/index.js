const { authenticate, authorize, optionalAuth } = require('./auth.middleware');
const { errorConverter, errorHandler, notFoundHandler } = require('./errorHandler');
const validate = require('./validate');
const { apiLimiter, authLimiter, createLimiter } = require('./rateLimiter');
const idempotency = require('./idempotency');

module.exports = {
  authenticate,
  authorize,
  optionalAuth,
  errorConverter,
  errorHandler,
  notFoundHandler,
  validate,
  apiLimiter,
  authLimiter,
  createLimiter,
  idempotency
};
