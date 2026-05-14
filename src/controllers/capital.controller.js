const { capitalService } = require('../services');
const { asyncHandler, successResponse, logAction } = require('../utils');
const { HTTP_STATUS } = require('../constants');
const { cloudinary } = require('../config/cloudinary');
const { env } = require('../config');
const { ApiError } = require('../utils');

/**
 * Get capital info
 * GET /api/capital
 */
const get = asyncHandler(async (req, res) => {
  const capital = await capitalService.get(req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(capital, 'Capital retrieved successfully')
  );
});

/**
 * Initialize capital
 * POST /api/capital/initialize
 * Body: { partner1, partner2, retainedEarnings } - sum = total capital
 */
const initialize = asyncHandler(async (req, res) => {
  const { partner1 = 0, partner2 = 0, retainedEarnings = 0 } = req.body;
  const capital = await capitalService.initialize(req.user.id, { partner1, partner2, retainedEarnings });

  logAction({
    req,
    action: 'INITIALIZE_CAPITAL',
    entityType: 'Capital',
    entityId: capital.id,
    metadata: { partner1, partner2, retainedEarnings }
  });

  res.status(HTTP_STATUS.CREATED).json(
    successResponse(capital, 'Capital initialized successfully')
  );
});

/**
 * Add transaction
 * PUT /api/capital
 */
const addTransaction = asyncHandler(async (req, res) => {
  const { amount, type, description, reference, investmentSubtype } = req.body;
  const capital = await capitalService.addTransaction(
    req.user.id,
    amount,
    type,
    description,
    reference,
    investmentSubtype
  );

  logAction({
    req,
    action: 'ADD_CAPITAL_TRANSACTION',
    entityType: 'Capital',
    entityId: capital.id,
    metadata: {
      amount,
      type,
      description,
      reference,
      investmentSubtype
    }
  });
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(capital, 'Transaction recorded successfully')
  );
});

/**
 * Get transactions
 * GET /api/capital/transactions
 */
const getTransactions = asyncHandler(async (req, res) => {
  const result = await capitalService.getTransactions(req.user.id, req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Transactions retrieved successfully', {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages
    })
  );
});

/**
 * Get capital summary
 * GET /api/capital/summary
 */
const getSummary = asyncHandler(async (req, res) => {
  const summary = await capitalService.getSummary(req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(summary, 'Capital summary retrieved successfully')
  );
});

/**
 * Upload invoice for a transaction
 * POST /api/capital/transactions/:transactionId/invoice
 */
const uploadInvoice = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.buffer) {
    throw ApiError.badRequest('Please upload an invoice file.');
  }

  const { transactionId } = req.params;

  // Check if Cloudinary is configured
  if (!env.cloudinary.cloudName || !env.cloudinary.apiKey || !env.cloudinary.apiSecret) {
    throw ApiError.badRequest(
      'File upload is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your environment.'
    );
  }

  // Upload to Cloudinary (using data URI - works with buffer)
  const base64 = req.file.buffer.toString('base64');
  const dataUri = `data:${req.file.mimetype};base64,${base64}`;

  const uploadResult = await cloudinary.uploader.upload(dataUri, {
    // M4 (Sprint 4): folder is namespaced per deployment via env.
    // Set FARM_KEY (or CLOUDINARY_INVOICE_FOLDER for full control) so two
    // farm deployments sharing a Cloudinary account don't co-mingle invoices.
    folder: env.cloudinary.invoiceFolder,
    resource_type: 'auto'
  }).catch((error) => {
    throw ApiError.badRequest(`Upload failed: ${error.message}`);
  });

  const invoiceUrl = uploadResult.secure_url;

  // Save URL to transaction
  const capital = await capitalService.updateTransactionInvoice(
    req.user.id,
    transactionId,
    invoiceUrl
  );

  logAction({
    req,
    action: 'UPLOAD_TRANSACTION_INVOICE',
    entityType: 'Capital',
    entityId: capital.id,
    metadata: { transactionId, invoiceUrl }
  });

  res.status(HTTP_STATUS.OK).json(
    successResponse(capital, 'Invoice uploaded successfully')
  );
});

module.exports = {
  get,
  initialize,
  addTransaction,
  getTransactions,
  getSummary,
  uploadInvoice
};
