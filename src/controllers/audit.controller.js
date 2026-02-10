const { AuditLog } = require('../models');
const { asyncHandler, successResponse, getPaginationOptions } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Get audit logs (Admin-only)
 * GET /api/audit-logs
 */
const getAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationOptions(req.query);

  const filter = {};

  if (req.query.userId) {
    filter.user = req.query.userId;
  }

  if (req.query.action) {
    filter.action = req.query.action;
  }

  if (req.query.startDate || req.query.endDate) {
    filter.createdAt = {};
    if (req.query.startDate) {
      filter.createdAt.$gte = new Date(req.query.startDate);
    }
    if (req.query.endDate) {
      filter.createdAt.$lte = new Date(req.query.endDate);
    }
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'name email role'),
    AuditLog.countDocuments(filter)
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  res.status(HTTP_STATUS.OK).json(
    successResponse(logs, 'Audit logs retrieved successfully', {
      page,
      limit,
      total,
      totalPages
    })
  );
});

module.exports = {
  getAuditLogs
};

