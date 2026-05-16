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

/**
 * Batched audit logger.
 *
 * Bulk operations (bulk create / bulk mark-sold / bulk health records) used to
 * fire one un-awaited `logAction()` per entity. For a pen-wide bulk that's
 * 100s–1000s of simultaneous `AuditLog.create()` calls, which floods the
 * Mongo connection pool and slows down every other in-flight query.
 *
 * This resolves the request context ONCE and writes all entries with a single
 * `AuditLog.insertMany`. Like `logAction`, it is fire-and-forget and never
 * throws into the caller.
 *
 * @param {Array<{userId?, action, entityType?, entityId?, metadata?}>} entries
 * @param {object?} sharedReq  optional explicit req (else AsyncLocalStorage)
 */
const logActionBatch = (entries, sharedReq = null) => {
  try {
    if (!Array.isArray(entries) || entries.length === 0) return;

    const effectiveReq = sharedReq || getRequest();

    const ctxUserId =
      effectiveReq && effectiveReq.user
        ? effectiveReq.user.id || effectiveReq.user._id
        : null;

    const ip =
      (effectiveReq
        && (effectiveReq.ip
          || (effectiveReq.headers
            && (effectiveReq.headers['x-forwarded-for'] || '')
          ).split(',')[0]))
      || null;

    const userAgent =
      (effectiveReq && effectiveReq.headers && effectiveReq.headers['user-agent']) || null;

    const docs = entries.map((e) => {
      const resolvedUserId = e.userId || ctxUserId || null;
      if (!resolvedUserId) {
        logger.warn(
          `Audit log missing userId for action: ${e.action} on ${e.entityType || 'unknown'}`
        );
      }
      return {
        user: resolvedUserId,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId ? String(e.entityId) : null,
        metadata: e.metadata,
        ip,
        userAgent
      };
    });

    AuditLog.insertMany(docs, { ordered: false }).catch((error) => {
      logger.error('Failed to write batched audit log', {
        error: error.message,
        count: docs.length,
        firstAction: docs[0]?.action
      });
    });
  } catch (error) {
    logger.error('Unexpected error in batched audit logger', {
      error: error.message
    });
  }
};

module.exports = {
  logAction,
  logActionBatch
};

