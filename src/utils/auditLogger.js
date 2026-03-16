const { AuditLog } = require('../models');
const logger = require('./logger');

/**
 * Non-blocking audit logger.
 * Failures are logged but do not affect the main request flow.
 */
const logAction = ({ req, userId, action, entityType, entityId, metadata }) => {
  try {
    const resolvedUserId =
      userId || (req && req.user ? req.user.id || req.user._id : null);

    // P6-06 / F-69: Warn when financial/critical operations have no audit trail owner
    if (!resolvedUserId) {
      logger.warn(`Audit log missing userId for action: ${action} on ${entityType || 'unknown'}`);
    }

    const ip =
      (req &&
        (req.ip ||
          (req.headers && (req.headers['x-forwarded-for'] || '')).split(',')[0])) ||
      null;

    const userAgent =
      (req && req.headers && req.headers['user-agent']) || null;

    AuditLog.create({
      user: resolvedUserId,
      action,
      entityType,
      entityId: entityId ? String(entityId) : null,
      metadata,
      ip,
      userAgent
    }).catch((error) => {
      logger.error('Failed to write audit log', {
        error: error.message,
        action,
        entityType,
        entityId
      });
    });
  } catch (error) {
    logger.error('Unexpected error in audit logger', {
      error: error.message,
      action,
      entityType,
      entityId
    });
  }
};

module.exports = {
  logAction
};

