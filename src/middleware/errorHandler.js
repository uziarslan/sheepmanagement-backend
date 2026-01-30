const mongoose = require('mongoose');
const { env } = require('../config');
const { ApiError, logger } = require('../utils');

/**
 * Convert non-ApiError errors to ApiError
 */
const errorConverter = (err, req, res, next) => {
  let error = err;

  if (!(error instanceof ApiError)) {
    const statusCode =
      error.statusCode ||
      (error instanceof mongoose.Error ? 400 : 500);
    
    const message = error.message || 'Internal Server Error';
    error = new ApiError(statusCode, message, false, err.stack);
  }

  next(error);
};

/**
 * Handle specific error types
 */
const handleSpecificErrors = (err) => {
  // Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((el) => el.message);
    const message = `Validation Error: ${errors.join('. ')}`;
    return new ApiError(400, message);
  }

  // Mongoose Duplicate Key Error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `${field} already exists.`;
    return new ApiError(409, message);
  }

  // Mongoose Cast Error (Invalid ID)
  if (err.name === 'CastError') {
    const message = `Invalid ${err.path}: ${err.value}`;
    return new ApiError(400, message);
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError') {
    return new ApiError(401, 'Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    return new ApiError(401, 'Token expired');
  }

  return err;
};

/**
 * Global error handler
 */
const errorHandler = (err, req, res, next) => {
  let error = handleSpecificErrors(err);

  const { statusCode = 500, message } = error;

  // Log error
  if (statusCode >= 500) {
    logger.error(`${statusCode} - ${message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
    if (env.isDevelopment) {
      logger.error(error.stack);
    }
  } else {
    logger.warn(`${statusCode} - ${message} - ${req.originalUrl} - ${req.method}`);
  }

  // Response
  const response = {
    success: false,
    status: error.status || 'error',
    statusCode,
    message,
    ...(env.isDevelopment && { stack: error.stack })
  };

  res.status(statusCode).json(response);
};

/**
 * Handle 404 errors
 */
const notFoundHandler = (req, res, next) => {
  const error = ApiError.notFound(`Route ${req.originalUrl} not found`);
  next(error);
};

module.exports = {
  errorConverter,
  errorHandler,
  notFoundHandler
};
