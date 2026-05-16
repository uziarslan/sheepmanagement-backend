const { AuditLog, User } = require('../models');
const { asyncHandler, successResponse, getPaginationOptions } = require('../utils');
const { HTTP_STATUS } = require('../constants');

/**
 * Build the Mongo filter from query params. Shared by list + facets so they
 * both narrow the same way as the user adjusts filters.
 */
const buildAuditFilter = (q) => {
  const filter = {};

  if (q.userId) filter.user = q.userId;
  if (q.entityType) filter.entityType = q.entityType;
  if (q.entityId) filter.entityId = q.entityId;
  if (q.ip) filter.ip = q.ip;

  // Action: support either a single string OR comma-separated list (multi-select).
  if (q.action) {
    const actions = String(q.action).split(',').map((s) => s.trim()).filter(Boolean);
    filter.action = actions.length === 1 ? actions[0] : { $in: actions };
  }

  // Free-text search: matches action / entityType / serialised metadata fields.
  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { action: rx },
      { entityType: rx },
      { entityId: rx },
      { ip: rx },
      { userAgent: rx }
    ];
  }

  if (q.startDate || q.endDate) {
    filter.createdAt = {};
    if (q.startDate) filter.createdAt.$gte = new Date(q.startDate);
    if (q.endDate) filter.createdAt.$lte = new Date(q.endDate);
  }

  return filter;
};

/**
 * Get audit logs (Admin-only). Supports filtering by user, action(s),
 * entityType, date range, IP, and free-text search. Default sort: newest first.
 *
 * GET /api/audit-logs
 */
const getAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationOptions(req.query);
  const filter = buildAuditFilter(req.query);

  // Allow per-field sort, defaulting to newest-first.
  let sort = { createdAt: -1 };
  if (req.query.sort) {
    sort = {};
    for (const field of String(req.query.sort).split(',')) {
      const f = field.trim();
      if (!f) continue;
      if (f.startsWith('-')) sort[f.slice(1)] = -1;
      else sort[f] = 1;
    }
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort(sort)
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

/**
 * Facets endpoint: distinct values for the audit-log filter dropdowns.
 *
 * GET /api/audit-logs/facets
 * Returns:
 *   {
 *     actions:     string[]              // all distinct action strings
 *     entityTypes: string[]              // all distinct entity types
 *     users:       { id, name, email }[] // users who appear in any audit log
 *   }
 *
 * Cheap aggregation — runs only when the admin opens the filter panel.
 */
const getAuditFacets = asyncHandler(async (req, res) => {
  const [actions, entityTypes, userIds] = await Promise.all([
    AuditLog.distinct('action'),
    AuditLog.distinct('entityType'),
    AuditLog.distinct('user')
  ]);

  const users = await User.find(
    { _id: { $in: userIds.filter(Boolean) } },
    'name email role'
  ).sort({ name: 1 }).lean();

  res.status(HTTP_STATUS.OK).json(
    successResponse({
      actions: actions.filter(Boolean).sort(),
      entityTypes: entityTypes.filter(Boolean).sort(),
      users
    }, 'Audit facets retrieved successfully')
  );
});

module.exports = {
  getAuditLogs,
  getAuditFacets
};
