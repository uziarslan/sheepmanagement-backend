const express = require('express');
const router = express.Router();
const { healthController } = require('../controllers');
const { authenticate, validate } = require('../middleware');
const { healthValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// ============ CURE TRACKING ============
router.get(
  '/cure-tracking',
  validate(healthValidation.getHealthRecords),
  healthController.getCureTracking
);

// ============ VACCINATIONS ============
router.get(
  '/vaccinations',
  validate(healthValidation.getHealthRecords),
  healthController.getVaccinations
);

router.post(
  '/vaccinations',
  validate(healthValidation.createVaccination),
  healthController.createVaccination
);

router.delete(
  '/vaccinations/:id',
  healthController.deleteVaccination
);

// ============ TREATMENTS ============
router.get(
  '/treatments',
  validate(healthValidation.getHealthRecords),
  healthController.getTreatments
);

router.post(
  '/treatments',
  validate(healthValidation.createTreatment),
  healthController.createTreatment
);

router.put(
  '/treatments/:id',
  validate(healthValidation.updateTreatment),
  healthController.updateTreatment
);

router.delete(
  '/treatments/:id',
  healthController.deleteTreatment
);

// ============ DEWORMINGS ============
router.get(
  '/dewormings',
  validate(healthValidation.getHealthRecords),
  healthController.getDewormings
);

router.post(
  '/dewormings',
  validate(healthValidation.createDeworming),
  healthController.createDeworming
);

router.delete(
  '/dewormings/:id',
  healthController.deleteDeworming
);

// ============ WEIGHT RECORDS ============
router.get(
  '/weight-records',
  validate(healthValidation.getHealthRecords),
  healthController.getWeightRecords
);

router.post(
  '/weight-records',
  validate(healthValidation.createWeightRecord),
  healthController.createWeightRecord
);

// ============ BCS RECORDS ============
router.get(
  '/bcs-records',
  validate(healthValidation.getHealthRecords),
  healthController.getBcsRecords
);

router.post(
  '/bcs-records',
  validate(healthValidation.createBcsRecord),
  healthController.createBcsRecord
);

// ============ HOOF RECORDS ============
router.get(
  '/hoof-records',
  validate(healthValidation.getHealthRecords),
  healthController.getHoofRecords
);

router.post(
  '/hoof-records',
  validate(healthValidation.createHoofRecord),
  healthController.createHoofRecord
);

router.put(
  '/hoof-records/:id',
  validate(healthValidation.updateHoofRecord),
  healthController.updateHoofRecord
);

router.delete(
  '/hoof-records/:id',
  healthController.deleteHoofRecord
);

module.exports = router;
