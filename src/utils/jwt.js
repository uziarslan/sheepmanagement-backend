const jwt = require('jsonwebtoken');
const { env } = require('../config');

/**
 * Generate access token
 * @param {Object} payload - Token payload
 * @returns {string} JWT token
 */
const generateToken = (payload) => {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn
  });
};

/**
 * Generate refresh token
 * @param {Object} payload - Token payload
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtRefreshExpiresIn
  });
};

/**
 * Verify token
 * @param {string} token - JWT token
 * @returns {Object} Decoded payload
 */
const verifyToken = (token) => {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch (error) {
    throw error;
  }
};

/**
 * Decode token without verification
 * @param {string} token - JWT token
 * @returns {Object} Decoded payload
 */
const decodeToken = (token) => {
  return jwt.decode(token);
};

/**
 * Generate both access and refresh tokens
 * @param {Object} user - User object
 * @returns {Object} tokens
 */
const generateTokenPair = (user) => {
  const payload = {
    id: user._id || user.id,
    email: user.email,
    role: user.role
  };

  return {
    accessToken: generateToken(payload),
    refreshToken: generateRefreshToken(payload)
  };
};

module.exports = {
  generateToken,
  generateRefreshToken,
  verifyToken,
  decodeToken,
  generateTokenPair
};
