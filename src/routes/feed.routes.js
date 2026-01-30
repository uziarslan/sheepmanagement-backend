const express = require('express');
const router = express.Router();
const { feedController } = require('../controllers');
const { authenticate, validate } = require('../middleware');
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
  validate(feedValidation.createRecipe),
  feedController.createRecipe
);

// PUT /api/feed/recipes/:id - Update recipe
router.put(
  '/recipes/:id',
  validate(feedValidation.updateRecipe),
  feedController.updateRecipe
);

// DELETE /api/feed/recipes/:id - Delete recipe
router.delete('/recipes/:id', feedController.deleteRecipe);

// ============ APPLICATIONS ============
// GET /api/feed/applications - Get all applications
router.get(
  '/applications',
  validate(feedValidation.getApplications),
  feedController.getApplications
);

// POST /api/feed/applications - Apply recipe
router.post(
  '/applications',
  validate(feedValidation.applyRecipe),
  feedController.applyRecipe
);

module.exports = router;
