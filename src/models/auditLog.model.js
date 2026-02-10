const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    action: {
      type: String,
      required: true,
      trim: true
    },
    entityType: {
      type: String,
      trim: true
    },
    entityId: {
      type: String,
      trim: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    ip: {
      type: String,
      trim: true
    },
    userAgent: {
      type: String,
      trim: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;

