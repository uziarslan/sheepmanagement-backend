const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { env } = require('./config');
const { logger } = require('./utils');
const {
  errorConverter,
  errorHandler,
  notFoundHandler,
  apiLimiter
} = require('./middleware');
const routes = require('./routes');

// Create Express app
const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: env.corsOrigin,
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

// Rate limiting (apply to all API routes)
if (env.isProduction) {
  app.use('/api', apiLimiter);
}

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
