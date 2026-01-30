/**
 * Build pagination options from query parameters
 * @param {Object} query - Request query object
 * @returns {Object} Pagination options
 */
const getPaginationOptions = (query) => {
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 10;
  const skip = (page - 1) * limit;
  
  return { page, limit, skip };
};

/**
 * Build sort options from query parameters
 * @param {string} sortQuery - Sort string (e.g., '-createdAt,name')
 * @returns {Object} Mongoose sort object
 */
const getSortOptions = (sortQuery) => {
  if (!sortQuery) return { createdAt: -1 };
  
  const sortObj = {};
  const fields = sortQuery.split(',');
  
  fields.forEach(field => {
    if (field.startsWith('-')) {
      sortObj[field.substring(1)] = -1;
    } else {
      sortObj[field] = 1;
    }
  });
  
  return sortObj;
};

/**
 * Build filter object from query parameters
 * @param {Object} query - Request query object
 * @param {Array} allowedFields - Fields allowed for filtering
 * @returns {Object} MongoDB filter object
 */
const buildFilter = (query, allowedFields = []) => {
  const filter = {};
  
  allowedFields.forEach(field => {
    if (query[field] !== undefined && query[field] !== '') {
      // Handle special operators
      if (typeof query[field] === 'object') {
        filter[field] = query[field];
      } else if (query[field] === 'true' || query[field] === 'false') {
        filter[field] = query[field] === 'true';
      } else {
        filter[field] = query[field];
      }
    }
  });
  
  // Handle search
  if (query.search && query.searchFields) {
    const searchFields = query.searchFields.split(',');
    filter.$or = searchFields.map(field => ({
      [field]: { $regex: query.search, $options: 'i' }
    }));
  }
  
  // Handle date range
  if (query.startDate || query.endDate) {
    filter.createdAt = {};
    if (query.startDate) {
      filter.createdAt.$gte = new Date(query.startDate);
    }
    if (query.endDate) {
      filter.createdAt.$lte = new Date(query.endDate);
    }
  }
  
  return filter;
};

/**
 * Build pagination response metadata
 * @param {number} total - Total count
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @returns {Object} Pagination metadata
 */
const getPaginationMeta = (total, page, limit) => {
  const totalPages = Math.ceil(total / limit);
  
  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1
  };
};

/**
 * Format success response
 * @param {*} data - Response data
 * @param {string} message - Success message
 * @param {Object} meta - Additional metadata
 * @returns {Object} Formatted response
 */
const successResponse = (data, message = 'Success', meta = null) => {
  const response = {
    success: true,
    message,
    data
  };
  
  if (meta) {
    response.meta = meta;
  }
  
  return response;
};

/**
 * Generate unique ID with prefix
 * @param {string} prefix - ID prefix
 * @returns {string} Unique ID
 */
const generateUniqueId = (prefix = '') => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 7);
  return `${prefix}${timestamp}${random}`.toUpperCase();
};

/**
 * Pick specific fields from object
 * @param {Object} obj - Source object
 * @param {Array} keys - Keys to pick
 * @returns {Object} New object with picked keys
 */
const pick = (obj, keys) => {
  return keys.reduce((acc, key) => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      acc[key] = obj[key];
    }
    return acc;
  }, {});
};

/**
 * Omit specific fields from object
 * @param {Object} obj - Source object
 * @param {Array} keys - Keys to omit
 * @returns {Object} New object without omitted keys
 */
const omit = (obj, keys) => {
  return Object.keys(obj).reduce((acc, key) => {
    if (!keys.includes(key)) {
      acc[key] = obj[key];
    }
    return acc;
  }, {});
};

module.exports = {
  getPaginationOptions,
  getSortOptions,
  buildFilter,
  getPaginationMeta,
  successResponse,
  generateUniqueId,
  pick,
  omit
};
