const { authService } = require('../services');
const { asyncHandler, successResponse } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Register a new user
 * POST /api/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(result, 'Registration successful')
  );
});

/**
 * Login user
 * POST /api/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result, 'Login successful')
  );
});

/**
 * Logout user
 * POST /api/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Logout successful')
  );
});

/**
 * Refresh access token
 * POST /api/auth/refresh-token
 */
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const tokens = await authService.refreshToken(refreshToken);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(tokens, 'Token refreshed successfully')
  );
});

/**
 * Get current user
 * GET /api/auth/me
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(user, 'User retrieved successfully')
  );
});

/**
 * Change password
 * PUT /api/auth/change-password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword(req.user.id, currentPassword, newPassword);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Password changed successfully')
  );
});

/**
 * Update profile
 * PUT /api/auth/profile
 */
const updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.id, req.body);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(user, 'Profile updated successfully')
  );
});

module.exports = {
  register,
  login,
  logout,
  refreshToken,
  getMe,
  changePassword,
  updateProfile
};
