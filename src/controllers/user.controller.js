const { userService } = require('../services');
const { asyncHandler, successResponse, logAction } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Create a new user (Admin-only)
 * POST /api/users
 */
const createUser = asyncHandler(async (req, res) => {
  const user = await userService.createUser(req.body);

  res.status(HTTP_STATUS.CREATED).json(
    successResponse(user, 'User created successfully')
  );

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
});

/**
 * Admin reset password for a user
 * PATCH /api/users/:id/password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;

  await userService.resetPassword(req.params.id, newPassword);

  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Password reset successfully')
  );

  logAction({
    req,
    userId: req.user.id,
    action: 'ADMIN_RESET_PASSWORD',
    entityType: 'User',
    entityId: req.params.id
  });
});

module.exports = {
  createUser,
  resetPassword
};

