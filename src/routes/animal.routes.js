const express = require('express');
const router = express.Router();
const { animalController } = require('../controllers');
const { authenticate, validate } = require('../middleware');
const { animalValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// GET /api/animals - Get all animals
router.get(
  '/',
  validate(animalValidation.getAnimals),
  animalController.getAll
);

// POST /api/animals/bulk - Bulk create animals
router.post(
  '/bulk',
  validate(animalValidation.bulkCreate),
  animalController.bulkCreate
);

// GET /api/animals/pen/:penId - Get animals by pen
router.get(
  '/pen/:penId',
  animalController.getByPen
);

// GET /api/animals/:id - Get animal by ID
router.get(
  '/:id',
  animalController.getById
);

// POST /api/animals - Create animal
router.post(
  '/',
  validate(animalValidation.createAnimal),
  animalController.create
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

// DELETE /api/animals/:id - Delete animal
router.delete(
  '/:id',
  animalController.remove
);

module.exports = router;
