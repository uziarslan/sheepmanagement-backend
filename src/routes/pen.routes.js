const express = require('express');
const router = express.Router();
const { penController } = require('../controllers');
const { authenticate, validate } = require('../middleware');
const { penValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// GET /api/pens/stats - Get pen statistics
router.get('/stats', penController.getStats);

// GET /api/pens - Get all pens
router.get(
  '/',
  validate(penValidation.getPens),
  penController.getAll
);

// GET /api/pens/:id - Get pen by ID
router.get('/:id', penController.getById);

// POST /api/pens - Create pen
router.post(
  '/',
  validate(penValidation.createPen),
  penController.create
);

// PUT /api/pens/:id - Update pen
router.put(
  '/:id',
  validate(penValidation.updatePen),
  penController.update
);

// DELETE /api/pens/:id - Delete pen
router.delete('/:id', penController.remove);

module.exports = router;
