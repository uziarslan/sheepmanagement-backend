const app = require('./app');
const { env, connectDB } = require('./config');
const { logger } = require('./utils');

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...');
  logger.error(err.name, err.message);
  logger.error(err.stack);
  process.exit(1);
});

// Connect to database and start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Start server
    const server = app.listen(env.port, () => {
      logger.info(`
========================================
  Server running in ${env.nodeEnv} mode
  Port: ${env.port}
  API: http://localhost:${env.port}/api
========================================
      `);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err) => {
      logger.error('UNHANDLED REJECTION! Shutting down...');
      logger.error(err.name, err.message);
      logger.error(err.stack);
      
      server.close(() => {
        process.exit(1);
      });
    });

    // Handle SIGTERM
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received. Shutting down gracefully...');
      server.close(() => {
        logger.info('Process terminated.');
      });
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
