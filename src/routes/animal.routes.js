const express = require('express');
const router = express.Router();
const { animalController } = require('../controllers');
const { authenticate, authorize, validate } = require('../middleware');
const { animalValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// GET /api/animals - Get all animals
router.get(
  '/',
  validate(animalValidation.getAnimals),
  animalController.getAll
);

// POST /api/animals/bulk - Bulk create animals (MUST come before /:id pattern)
router.post(
  '/bulk',
  validate(animalValidation.bulkCreate),
  animalController.bulkCreate
);

// POST /api/animals/bulk-mark-sold - Bulk mark animals as sold (Admin only, MUST come before /:id pattern)
router.post(
  '/bulk-mark-sold',
  authorize('Admin'),
  animalController.bulkMarkAsSold
);

// GET /api/animals/pen/:penId - Get animals by pen
router.get(
  '/pen/:penId',
  animalController.getByPen
);

// POST /api/animals - Create animal
router.post(
  '/',
  validate(animalValidation.createAnimal),
  animalController.create
);

// GET /api/animals/:id - Get animal by ID
router.get(
  '/:id',
  animalController.getById
);

// PUT /api/animals/:id - Update animal
router.put(
  '/:id',
  validate(animalValidation.updateAnimal),
  animalController.update
);

// PUT /api/animals/:id/move-to-pen - Move animal to pen
router.put(
  '/:id/move-to-pen',
  animalController.moveToPen
);

// PUT /api/animals/:id/declare-dead - Declare animal as dead
router.put(
  '/:id/declare-dead',
  animalController.declareDead
);

// PUT /api/animals/:id/mark-sold - Mark animal as sold (Admin only)
router.put(
  '/:id/mark-sold',
  authorize('Admin'),
  animalController.markAsSold
);

// DELETE /api/animals/:id - Delete animal
router.delete(
  '/:id',
  animalController.remove
);

// POST /api/animals/:id/recalculate-costs - Recalculate animal costs (Admin only)
router.post(
  '/:id/recalculate-costs',
  authorize('Admin'),
  animalController.recalculateAnimalCosts
);

module.exports = router;
