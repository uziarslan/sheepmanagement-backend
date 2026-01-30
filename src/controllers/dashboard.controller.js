const { dashboardService } = require('../services');
const { asyncHandler, successResponse } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Get dashboard statistics
 * GET /api/dashboard/stats
 */
const getStats = asyncHandler(async (req, res) => {
  const stats = await dashboardService.getStats(req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(stats, 'Dashboard statistics retrieved successfully')
  );
});

/**
 * Get recent activities
 * GET /api/dashboard/activities
 */
const getActivities = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 10;
  const activities = await dashboardService.getRecentActivities(req.user.id, limit);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(activities, 'Recent activities retrieved successfully')
  );
});

module.exports = {
  getStats,
  getActivities
};
