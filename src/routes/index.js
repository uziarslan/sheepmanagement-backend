const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const animalRoutes = require('./animal.routes');
const penRoutes = require('./pen.routes');
const stockRoutes = require('./stock.routes');
const employeeRoutes = require('./employee.routes');
const advanceRoutes = require('./advance.routes');
const liabilityRoutes = require('./liability.routes');
const healthRoutes = require('./health.routes');
const feedRoutes = require('./feed.routes');
const vaccinationRoutes = require('./vaccination.routes');
const capitalRoutes = require('./capital.routes');
const salaryRoutes = require('./salary.routes');
const dashboardRoutes = require('./dashboard.routes');
const userRoutes = require('./user.routes');
const auditRoutes = require('./audit.routes');

// API Routes
router.use('/auth', authRoutes);
router.use('/animals', animalRoutes);
router.use('/pens', penRoutes);
router.use('/stocks', stockRoutes);
router.use('/employees', employeeRoutes);
router.use('/advances', advanceRoutes);
router.use('/liabilities', liabilityRoutes);
router.use('/health', healthRoutes);
router.use('/feed', feedRoutes);
router.use('/vaccination', vaccinationRoutes);
router.use('/capital', capitalRoutes);
router.use('/salaries', salaryRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/users', userRoutes);
router.use('/audit-logs', auditRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
