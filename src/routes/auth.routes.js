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

router.post(
  '/refresh-token',
  validate(authValidation.refreshToken),
  authController.refreshToken
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
