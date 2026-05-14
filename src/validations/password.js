const Joi = require('joi');

/**
 * Shared password Joi rule.
 *
 * Sprint 5 follow-up: the 10-char + complexity (AU2 from Sprint 4) was reverted
 * per user request. Back to min(6) — same as the original Mongoose model.
 * Kept as a shared rule so any future hardening only has to touch one file.
 */
const STRONG_PASSWORD = Joi.string().min(6).max(128);

module.exports = { STRONG_PASSWORD };
