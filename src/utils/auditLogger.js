const { AuditLog } = require('../models');
const logger = require('./logger');
const { getRequest } = require('./requestContext');

/**
 * Non-blocking audit logger.
 * Failures are logged but do not affect the main request flow.
 *
 * AL2 (Sprint 4): if `req` is not passed explicitly, falls back to the live
 * request stashed in AsyncLocalStorage by requestContextMiddleware. This is
 * how service-layer callers (which never had access to `req`) now get IP and
 * userAgent recorded without changing their signatures.
 */
const logAction = ({ req, userId, action, entityType, entityId, metadata }) => {
  try {
    const effectiveReq = req || getRequest();

    const resolvedUserId =
      userId
      || (effectiveReq && effectiveReq.user
        ? effectiveReq.user.id || effectiveReq.user._id
        : null);

    if (!resolvedUserId) {
      logger.warn(`Audit log missing userId for action: ${action} on ${entityType || 'unknown'}`);
    }

    const ip =
      (effectiveReq
        && (effectiveReq.ip
          || (effectiveReq.headers
            && (effectiveReq.headers['x-forwarded-for'] || '')
          ).split(',')[0]))
      || null;

    const userAgent =
      (effectiveReq && effectiveReq.headers && effectiveReq.headers['user-agent']) || null;

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

