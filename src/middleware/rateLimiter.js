const rateLimit = require('express-rate-limit');
const { env } = require('../config');
const { ApiError } = require('../utils');

/**
 * General API rate limiter
 */
const apiLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs, // 15 minutes
  max: env.rateLimitMaxRequests, // 100 requests per window
  message: {
    success: false,
    status: 'fail',
    statusCode: 429,
    message: 'Too many requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    throw ApiError.tooManyRequests(options.message.message);
  }
});

/**
 * Auth routes rate limiter (stricter)
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: {
    success: false,
    status: 'fail',
    statusCode: 429,
    message: 'Too many authentication attempts, please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  handler: (req, res, next, options) => {
    throw ApiError.tooManyRequests(options.message.message);
  }
});

/**
 * Create custom rate limiter
 */
const createLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      status: 'fail',
      statusCode: 429,
      message
    },
    standardHeaders: true,
    legacyHeaders: false
  });
};

module.exports = {
  apiLimiter,
  authLimiter,
  createLimiter
};
