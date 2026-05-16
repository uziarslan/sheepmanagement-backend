const express = require('express');
const router = express.Router();
const { authController } = require('../controllers');
const { authenticate, validate, authLimiter } = require('../middleware');
const { authValidation } = require('../validations');

// Public routes (with rate limiting)
router.post(
  '/register',
  authLimiter,
  validate(authValidation.register),
  authController.register
);

router.post(
  '/login',
  authLimiter,
  validate(authValidation.login),
  authController.login
);

// P4-05: Rate-limit refresh-token to prevent brute-force session hijacking
router.post(
  '/refresh-token',
  authLimiter,
  validate(authValidation.refreshToken),
  authController.refreshToken
);

// Password reset is intentionally NOT a public flow on this deployment.
// Users must request a reset from an Admin, who uses:
//   PATCH /api/users/:id/password
//   PATCH /api/employees/:id/reset-password
// AU5 (Sprint 4): replaced the 501 stubs with explicit 410 Gone messages so
// clients stop hitting these endpoints and probing the password-reset surface.
const goneHandler = (req, res) => {
  res.status(410).json({
    success: false,
    message:
      'This endpoint is not available. Ask an administrator to reset your ' +
      'password via the admin reset flow (PATCH /api/users/:id/password).'
  });
};

router.post('/forgot-password', authLimiter, goneHandler);
router.post('/reset-password', authLimiter, goneHandler);

// Protected routes
router.use(authenticate); // All routes below require authentication

router.post('/logout', authController.logout);

router.get('/me', authController.getMe);

router.put(
  '/change-password',
  validate(authValidation.changePassword),
  authController.changePassword
);

router.put(
  '/profile',
  validate(authValidation.updateProfile),
  authController.updateProfile
);

module.exports = router;
