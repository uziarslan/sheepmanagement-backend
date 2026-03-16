const express = require('express');
const router = express.Router();
const { userController } = require('../controllers');
const { authenticate, authorize, validate } = require('../middleware');
const { userValidation } = require('../validations');

// All routes require authentication and admin role
router.use(authenticate);
router.use(authorize('Admin'));

// GET /api/users - List all users (Admin only)
router.get('/', userController.getUsers);

// POST /api/users - Create a new user (Admin or Employee account)
router.post(
  '/',
  validate(userValidation.createUser),
  userController.createUser
);

// PATCH /api/users/:id/password - Admin reset user password
router.patch(
  '/:id/password',
  validate(userValidation.resetPassword),
  userController.resetPassword
);

// PATCH /api/users/:id/activate - Reactivate a deactivated user (P4-04 / F-65)
router.patch('/:id/activate', userController.activateUser);

module.exports = router;

