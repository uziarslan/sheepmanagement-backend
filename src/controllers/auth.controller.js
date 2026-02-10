const { authService } = require('../services');
const { asyncHandler, successResponse, logAction } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Register a new user
 * POST /api/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);

  logAction({
    req,
    userId: result.user?.id,
    action: 'REGISTER',
    entityType: 'User',
    entityId: result.user?.id,
    metadata: {
      email: result.user?.email,
      role: result.user?.role
    }
  });

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

  logAction({
    req,
    userId: result.user?.id,
    action: 'LOGIN',
    entityType: 'User',
    entityId: result.user?.id,
    metadata: {
      email: result.user?.email
    }
  });

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

  logAction({
    req,
    userId: req.user.id,
    action: 'LOGOUT',
    entityType: 'User',
    entityId: req.user.id
  });

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

  logAction({
    req,
    userId: req.user.id,
    action: 'CHANGE_PASSWORD',
    entityType: 'User',
    entityId: req.user.id
  });

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

  logAction({
    req,
    userId: req.user.id,
    action: 'UPDATE_PROFILE',
    entityType: 'User',
    entityId: req.user.id,
    metadata: req.body
  });

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
