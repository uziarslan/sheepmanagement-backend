const { User } = require('../models');
const { jwt, ApiError } = require('../utils');

/**
 * Register a new user
 */
const register = async (userData) => {
  // Check if email already exists
  const existingUser = await User.findOne({ email: userData.email });
  if (existingUser) {
    throw ApiError.conflict('Email already registered');
  }

  // Create user
  const user = await User.create({
    name: userData.name,
    email: userData.email,
    password: userData.password,
    farmName: userData.farmName,
    phone: userData.phone
  });

  // Generate tokens
  const tokens = jwt.generateTokenPair(user);

  // Save refresh token
  user.refreshToken = tokens.refreshToken;
  await user.save();

  return {
    user: user.toJSON(),
    tokens
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

  // Save refresh token
  user.refreshToken = tokens.refreshToken;
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
const refreshToken = async (refreshToken) => {
  try {
    // Verify refresh token
    const decoded = jwt.verifyToken(refreshToken);

    // Find user with this refresh token
    const user = await User.findById(decoded.id).select('+refreshToken');

    if (!user || user.refreshToken !== refreshToken) {
      throw ApiError.unauthorized('Invalid refresh token');
    }

    if (!user.isActive) {
      throw ApiError.unauthorized('Account is deactivated');
    }

    // Generate new tokens
    const tokens = jwt.generateTokenPair(user);

    // Save new refresh token
    user.refreshToken = tokens.refreshToken;
    await user.save();

    return tokens;
  } catch (error) {
    throw ApiError.unauthorized('Invalid refresh token');
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
