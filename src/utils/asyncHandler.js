/**
 * Async handler wrapper to catch errors in async route handlers
 * Eliminates the need for try-catch blocks in every controller
 * 
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Express middleware function
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
