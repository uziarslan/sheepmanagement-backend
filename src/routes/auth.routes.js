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

// Password reset routes (future implementation)
router.post(
  '/forgot-password',
  authLimiter,
  // TODO: Implement forgot password - send reset email
  (req, res) => {
    res.status(501).json({
      success: false,
      message: 'Password reset feature coming soon'
    });
  }
);

router.post(
  '/reset-password',
  authLimiter,
  // TODO: Implement reset password - validate token and update password
  (req, res) => {
    res.status(501).json({
      success: false,
      message: 'Password reset feature coming soon'
    });
  }
);

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
