const { User } = require('../models');
const { jwt, ApiError, asyncHandler } = require('../utils');

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 */
const authenticate = asyncHandler(async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // Check if token exists
  if (!token) {
    throw ApiError.unauthorized('Access denied. No token provided.');
  }

  try {
    // Verify token
    const decoded = jwt.verifyToken(token);

    // Get user from token
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      throw ApiError.unauthorized('User not found.');
    }

    // Check if user is active
    if (!user.isActive) {
      throw ApiError.unauthorized('User account is deactivated.');
    }

    // Check if user changed password after token was issued
    if (user.changedPasswordAfter(decoded.iat)) {
      throw ApiError.unauthorized('Password recently changed. Please login again.');
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      throw ApiError.unauthorized('Invalid token.');
    }
    if (error.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Token expired.');
    }
    throw error;
  }
});

/**
 * Authorization middleware
 * Restricts access based on user roles
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      throw ApiError.unauthorized('Access denied.');
    }

    if (!roles.includes(req.user.role)) {
      throw ApiError.forbidden('You do not have permission to perform this action.');
    }

    next();
  };
};

/**
 * Optional authentication middleware
 * Attaches user if token is valid, but doesn't require it
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (token) {
    try {
      const decoded = jwt.verifyToken(token);
      const user = await User.findById(decoded.id).select('-password');
      
      if (user && user.isActive) {
        req.user = user;
      }
    } catch (error) {
      // Token is invalid, but that's okay - continue without user
    }
  }

  next();
});

module.exports = {
  authenticate,
  authorize,
  optionalAuth
};
