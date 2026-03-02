const multer = require('multer');
const { ApiError } = require('../utils');

// Memory storage - file will be in req.file.buffer for Cloudinary
const storage = multer.memoryStorage();

// File filter - allow images and PDFs for invoices
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/pdf'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(ApiError.badRequest('Invalid file type. Please upload an image (JPEG, PNG, WebP) or PDF.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  }
});

/**
 * Middleware for single invoice file upload
 * Expects field name: 'invoice'
 */
const uploadInvoice = upload.single('invoice');

module.exports = {
  uploadInvoice
};
