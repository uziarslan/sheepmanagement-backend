const express = require('express');
const router = express.Router();
const { feedController } = require('../controllers');
const { authenticate, authorize, validate, idempotency } = require('../middleware');
const { feedValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// ============ RECIPES ============
// GET /api/feed/recipes - Get all recipes
router.get(
  '/recipes',
  validate(feedValidation.getRecipes),
  feedController.getAllRecipes
);

// GET /api/feed/recipes/:id - Get recipe by ID
router.get('/recipes/:id', feedController.getRecipeById);

// POST /api/feed/recipes - Create recipe
router.post(
  '/recipes',
  authorize('Admin', 'Manager'),
  validate(feedValidation.createRecipe),
  feedController.createRecipe
);

// PUT /api/feed/recipes/:id - Update recipe
router.put(
  '/recipes/:id',
  authorize('Admin', 'Manager'),
  validate(feedValidation.updateRecipe),
  feedController.updateRecipe
);

// DELETE /api/feed/recipes/:id - Delete recipe
router.delete('/recipes/:id', authorize('Admin', 'Manager'), feedController.deleteRecipe);

// ============ APPLICATIONS ============
// GET /api/feed/applications - Get all applications
router.get(
  '/applications',
  validate(feedValidation.getApplications),
  feedController.getApplications
);

// POST /api/feed/applications/range - Apply recipe over a date range (P3-09)
// NOTE: must be registered BEFORE /applications/:id to avoid route shadowing
router.post(
  '/applications/range',
  authorize('Admin', 'Manager', 'Employee'),
  idempotency,
  validate(feedValidation.applyRecipeRange),
  feedController.applyRecipeRange
);

// POST /api/feed/applications - Apply recipe
router.post(
  '/applications',
  authorize('Admin', 'Manager', 'Employee'),
  idempotency,
  validate(feedValidation.applyRecipe),
  feedController.applyRecipe
);

module.exports = router;
