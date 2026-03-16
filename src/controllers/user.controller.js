const { userService } = require('../services');
const { asyncHandler, successResponse, logAction } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Create a new user (Admin-only)
 * POST /api/users
 */
const createUser = asyncHandler(async (req, res) => {
  const user = await userService.createUser(req.body);

  // Log BEFORE sending response
  logAction({
    req,
    userId: req.user.id,
    action: 'CREATE_USER',
    entityType: 'User',
    entityId: user.id,
    metadata: {
      email: user.email,
      role: user.role,
      employeeId: user.employee || null
    }
  });

  res.status(HTTP_STATUS.CREATED).json(
    successResponse(user, 'User created successfully')
  );
});

/**
 * Get all users (Admin-only)
 * GET /api/users
 */
const getUsers = asyncHandler(async (req, res) => {
  const users = await userService.getUsers();
  res.status(HTTP_STATUS.OK).json(
    successResponse(users, 'Users retrieved successfully')
  );
});

/**
 * Admin reset password for a user
 * PATCH /api/users/:id/password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;

  await userService.resetPassword(req.params.id, newPassword);

  logAction({
    req,
    userId: req.user.id,
    action: 'ADMIN_RESET_PASSWORD',
    entityType: 'User',
    entityId: req.params.id
  });

  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Password reset successfully')
  );
});

/**
 * Reactivate a deactivated user (P4-04 / F-65)
 * PATCH /api/users/:id/activate
 */
const activateUser = asyncHandler(async (req, res) => {
  const user = await userService.activateUser(req.params.id);

  logAction({
    req,
    userId: req.user.id,
    action: 'ACTIVATE_USER',
    entityType: 'User',
    entityId: req.params.id
  });

  res.status(HTTP_STATUS.OK).json(
    successResponse(user, 'User activated successfully')
  );
});

module.exports = {
  createUser,
  getUsers,
  resetPassword,
  activateUser
};

