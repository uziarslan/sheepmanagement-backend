const express = require('express');
const router = express.Router();
const { animalController } = require('../controllers');
const { authenticate, authorize, validate, idempotency, createLimiter } = require('../middleware');
const { animalValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// Stricter throttle for the heavy bulk-write endpoints (audit L-17): a single
// bulk call can insert/sell hundreds of animals, so it shouldn't share the
// general per-IP budget freely.
const bulkLimiter = createLimiter(
  15 * 60 * 1000, // 15 minutes
  30,             // 30 bulk operations per window
  'Too many bulk operations, please slow down and try again shortly.'
);

// GET /api/animals - Get all animals
router.get(
  '/',
  validate(animalValidation.getAnimals),
  animalController.getAll
);

// POST /api/animals/bulk - Bulk create animals (Admin, Manager — moves capital)
router.post(
  '/bulk',
  authorize('Admin', 'Manager'),
  bulkLimiter,
  idempotency,
  validate(animalValidation.bulkCreate),
  animalController.bulkCreate
);

// POST /api/animals/bulk-mark-sold - Bulk mark animals as sold (Admin only, MUST come before /:id pattern)
router.post(
  '/bulk-mark-sold',
  authorize('Admin'),
  bulkLimiter,
  idempotency,
  validate(animalValidation.bulkMarkAsSold),
  animalController.bulkMarkAsSold
);

// POST /api/animals/by-tagids - Bulk lookup by Tag IDs (used by bulk sale/operations)
router.post(
  '/by-tagids',
  validate(animalValidation.getByTagIds),
  animalController.getByTagIds
);

// GET /api/animals/pen/:penId - Get animals by pen
router.get(
  '/pen/:penId',
  animalController.getByPen
);

// POST /api/animals - Create animal (Admin, Manager — moves capital)
router.post(
  '/',
  authorize('Admin', 'Manager'),
  idempotency,
  validate(animalValidation.createAnimal),
  animalController.create
);

// GET /api/animals/:id - Get animal by ID
router.get(
  '/:id',
  animalController.getById
);

// PUT /api/animals/:id - Update animal (Admin, Manager)
router.put(
  '/:id',
  authorize('Admin', 'Manager'),
  validate(animalValidation.updateAnimal),
  animalController.update
);

// PUT /api/animals/:id/move-to-pen - Move animal to pen (Admin, Manager)
router.put(
  '/:id/move-to-pen',
  authorize('Admin', 'Manager'),
  validate(animalValidation.moveToPen),
  animalController.moveToPen
);

// PUT /api/animals/:id/declare-dead - Declare animal as dead (Admin, Manager — financial impact)
router.put(
  '/:id/declare-dead',
  authorize('Admin', 'Manager'),
  idempotency,
  validate(animalValidation.declareDead),
  animalController.declareDead
);

// PUT /api/animals/:id/mark-sold - Mark animal as sold (Admin only)
router.put(
  '/:id/mark-sold',
  authorize('Admin'),
  idempotency,
  validate(animalValidation.markAsSold),
  animalController.markAsSold
);

// PUT /api/animals/:id/restore-from-dead - Reverse a declare-dead (Admin only)
router.put(
  '/:id/restore-from-dead',
  authorize('Admin'),
  idempotency,
  animalController.restoreFromDead
);

// PUT /api/animals/:id/restore-from-sold - Reverse a mark-sold (Admin only)
router.put(
  '/:id/restore-from-sold',
  authorize('Admin'),
  idempotency,
  animalController.restoreFromSold
);

// DELETE /api/animals/:id - Delete animal (Admin only — reverses capital)
router.delete(
  '/:id',
  authorize('Admin'),
  animalController.remove
);

// POST /api/animals/:id/recalculate-costs - Recalculate animal costs (Admin only)
router.post(
  '/:id/recalculate-costs',
  authorize('Admin'),
  animalController.recalculateAnimalCosts
);

module.exports = router;
