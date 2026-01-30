const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const animalRoutes = require('./animal.routes');
const penRoutes = require('./pen.routes');
const stockRoutes = require('./stock.routes');
const employeeRoutes = require('./employee.routes');
const advanceRoutes = require('./advance.routes');
const healthRoutes = require('./health.routes');
const feedRoutes = require('./feed.routes');
const capitalRoutes = require('./capital.routes');
const dashboardRoutes = require('./dashboard.routes');

// API Routes
router.use('/auth', authRoutes);
router.use('/animals', animalRoutes);
router.use('/pens', penRoutes);
router.use('/stocks', stockRoutes);
router.use('/employees', employeeRoutes);
router.use('/advances', advanceRoutes);
router.use('/health', healthRoutes);
router.use('/feed', feedRoutes);
router.use('/capital', capitalRoutes);
router.use('/dashboard', dashboardRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
