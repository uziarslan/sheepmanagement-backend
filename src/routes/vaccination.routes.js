const express = require('express');
const router = express.Router();
const { vaccinationController } = require('../controllers');
const { authenticate, validate } = require('../middleware');
const { vaccinationValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// ============ VACCINES ============
// GET /api/vaccination/vaccines - Get all vaccines (from stock with category=Medication)
router.get(
  '/vaccines',
  validate(vaccinationValidation.getVaccines),
  vaccinationController.getAllVaccines
);

// GET /api/vaccination/vaccines/:id - Get vaccine by ID
router.get('/vaccines/:id', vaccinationController.getVaccineById);

// POST /api/vaccination/vaccines - Create vaccine (add to stock)
router.post(
  '/vaccines',
  validate(vaccinationValidation.createVaccine),
  vaccinationController.createVaccine
);

// PUT /api/vaccination/vaccines/:id - Update vaccine
router.put(
  '/vaccines/:id',
  validate(vaccinationValidation.updateVaccine),
  vaccinationController.updateVaccine
);

// DELETE /api/vaccination/vaccines/:id - Delete vaccine
router.delete('/vaccines/:id', vaccinationController.deleteVaccine);

// ============ APPLICATIONS ============
// GET /api/vaccination/applications - Get all applications
router.get(
  '/applications',
  validate(vaccinationValidation.getApplications),
  vaccinationController.getApplications
);

// POST /api/vaccination/applications - Apply vaccine
router.post(
  '/applications',
  validate(vaccinationValidation.applyVaccine),
  vaccinationController.applyVaccine
);

// GET /api/vaccination/applications/:id - Get application by ID
router.get('/applications/:id', vaccinationController.getApplicationById);

// DELETE /api/vaccination/applications/:id - Delete application
router.delete('/applications/:id', vaccinationController.deleteApplication);

module.exports = router;
