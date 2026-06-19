const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { env } = require('./config');
const { logger } = require('./utils');
const { requestContextMiddleware } = require('./utils/requestContext');
const {
  errorConverter,
  errorHandler,
  notFoundHandler,
  apiLimiter,
  createLimiter
} = require('./middleware');
const routes = require('./routes');

// Create Express app
const app = express();


// Security middleware
app.use(helmet());


// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, Postman, or same-origin)
    if (!origin) return callback(null, true);
    
    if (env.corsOrigin.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Request logging
if (env.isDevelopment) {
  app.use(morgan('dev', { stream: logger.stream }));
} else {
  app.use(morgan('combined', { stream: logger.stream }));
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// AL2 (Sprint 4): per-request async-context stash. Lets deep service-layer
// `logAction` calls auto-pick up the current request for IP/userAgent
// without threading `req` through every signature.
app.use(requestContextMiddleware);

// Rate limiting (apply to all API routes in all environments)
app.use('/api', apiLimiter);

// Stricter rate limiting for refresh-token endpoint
const refreshTokenLimiter = createLimiter(
  15 * 60 * 1000, // 15 minutes
  5, // 5 attempts per window (stricter than general API limit)
  'Too many token refresh attempts, please try again later.'
);
app.use('/api/auth/refresh-token', refreshTokenLimiter);

// API Routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Sheep Management System API',
    version: '1.0.0',
    documentation: '/api/health'
  });
});

// 404 handler
app.use(notFoundHandler);

// Error handlers
app.use(errorConverter);
app.use(errorHandler);

module.exports = app;
