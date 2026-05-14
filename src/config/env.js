const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const env = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  
  // MongoDB
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/sheep_management',
  
  // JWT
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  
  // CORS
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
    : ['http://localhost:3000'],
  
  // Rate Limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000, // 15 minutes
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',

  // Cloudinary. `folder` namespaces uploads per deployment so multiple farms
  // sharing the same Cloudinary account don't co-mingle invoices. Defaults to
  // `sheep-management/<FARM_KEY>/invoices`; if no FARM_KEY is set, falls back
  // to the legacy shared folder (kept for backward compat).
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    invoiceFolder: process.env.CLOUDINARY_INVOICE_FOLDER
      || (process.env.FARM_KEY
        ? `sheep-management/${String(process.env.FARM_KEY).replace(/[^A-Za-z0-9_-]/g, '_')}/invoices`
        : 'sheep-management/invoices')
  },

  // FARM_KEY is a stable per-deployment identifier (e.g. "green-pastures").
  // It is consumed by anything that needs to namespace shared external storage
  // (Cloudinary, S3, etc.) so two farm deployments don't collide.
  farmKey: process.env.FARM_KEY || null,

  // Helpers
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test'
};

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];

requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    throw new Error(`Environment variable ${varName} is required`);
  }
});

// Validate additional required env vars in production
if (env.isProduction) {
  const productionRequiredEnvVars = ['MONGODB_URI'];

  productionRequiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
      throw new Error(`Environment variable ${varName} is required in production`);
    }
  });
}

module.exports = env;
