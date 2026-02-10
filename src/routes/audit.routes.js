const express = require('express');
const router = express.Router();
const { auditController } = require('../controllers');
const { authenticate, authorize } = require('../middleware');

// All audit routes require authentication and admin role
router.use(authenticate);
router.use(authorize('Admin'));

// GET /api/audit-logs - Get audit logs with optional filters
router.get('/', auditController.getAuditLogs);

module.exports = router;

