const express = require('express');
const router = express.Router();
const { dashboardController } = require('../controllers');
const { authenticate } = require('../middleware');

// All routes require authentication
router.use(authenticate);

// GET /api/dashboard/stats - Get dashboard statistics
router.get('/stats', dashboardController.getStats);

// GET /api/dashboard/activities - Get recent activities
router.get('/activities', dashboardController.getActivities);

module.exports = router;
