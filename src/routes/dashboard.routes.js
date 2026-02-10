const express = require('express');
const router = express.Router();
const { dashboardController } = require('../controllers');
const { authenticate, authorize } = require('../middleware');

// All routes require authentication and admin role
router.use(authenticate);
router.use(authorize('Admin'));

// GET /api/dashboard/stats - Get dashboard statistics
router.get('/stats', dashboardController.getStats);

// GET /api/dashboard/activities - Get recent activities
router.get('/activities', dashboardController.getActivities);

module.exports = router;
