const crypto = require('crypto');
const { User } = require('../models');
const { jwt, ApiError } = require('../utils');

/**
 * Hash refresh token with SHA-256
 */
const hashRefreshToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Register a new user.
 *
 * Bootstrap: when no Admin exists yet, the first registrant is promoted to
 * 'Admin' so the operator can manage the deployment. All subsequent public
 * registrations are created as 'Manager'.
 */
const register = async (userData) => {
  const existingUser = await User.findOne({ email: userData.email });
  if (existingUser) {
    throw ApiError.conflict('Email already registered');
  }

  const adminCount = await User.countDocuments({ role: 'Admin' });
  const isBootstrap = adminCount === 0;

  const user = await User.create({
    name: userData.name,
    email: userData.email,
    password: userData.password,
    farmName: userData.farmName,
    phone: userData.phone,
    role: isBootstrap ? 'Admin' : 'Manager'
  });

  const tokens = jwt.generateTokenPair(user);
  user.refreshToken = hashRefreshToken(tokens.refreshToken);
  await user.save();

  return {
    user: user.toJSON(),
    tokens,
    bootstrap: isBootstrap
  };
};

/**
 * Login user
 */
const login = async (email, password) => {
  // Find user by email
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // Check if user is active
  if (!user.isActive) {
    throw ApiError.unauthorized('Account is deactivated. Contact administrator.');
  }

  // Verify password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // Generate tokens
  const tokens = jwt.generateTokenPair(user);

  // Save hashed refresh token
  user.refreshToken = hashRefreshToken(tokens.refreshToken);
  await user.save();

  return {
    user: user.toJSON(),
    tokens
  };
};

/**
 * Logout user
 */
const logout = async (userId) => {
  await User.findByIdAndUpdate(userId, { refreshToken: null });
  return true;
};

/**
 * Refresh access token
 */
const refreshToken = async (refreshTokenStr) => {
  try {
    // Verify refresh token signature
    const decoded = jwt.verifyRefreshToken(refreshTokenStr);

    // Find user with this refresh token
    const user = await User.findById(decoded.id).select('+refreshToken');

    if (!user) {
      throw ApiError.unauthorized('Invalid refresh token');
    }

    // Compare hashed refresh token
    const tokenHash = hashRefreshToken(refreshTokenStr);
    if (user.refreshToken !== tokenHash) {
      throw ApiError.unauthorized('Invalid refresh token');
    }

    if (!user.isActive) {
      throw ApiError.unauthorized('Account is deactivated');
    }

    // Generate new tokens
    const tokens = jwt.generateTokenPair(user);

    // Save new hashed refresh token
    user.refreshToken = hashRefreshToken(tokens.refreshToken);
    await user.save();

    return tokens;
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Invalid refresh token');
    }
    throw error;
  }
};

/**
 * Change password
 */
const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await User.findById(userId).select('+password');

  if (!user) {
    throw ApiError.notFound('User not found');
  }

  // Verify current password
  const isPasswordValid = await user.comparePassword(currentPassword);
  if (!isPasswordValid) {
    throw ApiError.badRequest('Current password is incorrect');
  }

  // Update password
  user.password = newPassword;
  await user.save();

  return true;
};

/**
 * Get current user
 */
const getMe = async (userId) => {
  const user = await User.findById(userId);
  
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  return user;
};

/**
 * Update profile
 */
const updateProfile = async (userId, updateData) => {
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!user) {
    throw ApiError.notFound('User not found');
  }

  return user;
};

module.exports = {
  register,
  login,
  logout,
  refreshToken,
  changePassword,
  getMe,
  updateProfile
};
