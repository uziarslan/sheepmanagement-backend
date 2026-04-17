const express = require('express');
const router = express.Router();
const { healthController } = require('../controllers');
const { authenticate, authorize, validate } = require('../middleware');
const { healthValidation } = require('../validations');

// All routes require authentication
router.use(authenticate);

// ============ CURE TRACKING ============
router.get(
  '/cure-tracking',
  validate(healthValidation.getHealthRecords),
  healthController.getCureTracking
);

// ============ VACCINATIONS (LEGACY — P5-01 / F-14) ============
// DEPRECATED: Use /api/vaccination/applications instead.
// These legacy endpoints lack proper stock deduction and consistent cost tracking.
// POST and DELETE are blocked; GET is preserved for historical data viewing only.
const deprecationWarning = (req, res, next) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', 'Use /api/vaccination/applications instead');
  next();
};

router.get(
  '/vaccinations',
  deprecationWarning,
  validate(healthValidation.getHealthRecords),
  healthController.getVaccinations
);

router.post(
  '/vaccinations',
  (req, res) => res.status(410).json({
    success: false,
    message: 'This endpoint is deprecated. Use POST /api/vaccination/applications instead.'
  })
);

router.delete(
  '/vaccinations/:id',
  authorize('Admin', 'Manager'),
  deprecationWarning,
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
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.createTreatment),
  healthController.createTreatment
);

router.put(
  '/treatments/:id',
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.updateTreatment),
  healthController.updateTreatment
);

router.delete(
  '/treatments/:id',
  authorize('Admin', 'Manager'),
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
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.createDeworming),
  healthController.createDeworming
);

router.delete(
  '/dewormings/:id',
  authorize('Admin', 'Manager'),
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
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.createWeightRecord),
  healthController.createWeightRecord
);

router.post(
  '/weight-records/bulk',
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.bulkCreateWeightRecords),
  healthController.bulkCreateWeightRecords
);

// ============ TEMPERATURE RECORDS ============
router.get(
  '/temperature-records',
  validate(healthValidation.getHealthRecords),
  healthController.getTemperatureRecords
);

router.post(
  '/temperature-records',
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.createTemperatureRecord),
  healthController.createTemperatureRecord
);

router.post(
  '/temperature-records/bulk',
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.bulkCreateTemperatureRecords),
  healthController.bulkCreateTemperatureRecords
);

// ============ BCS RECORDS ============
router.get(
  '/bcs-records',
  validate(healthValidation.getHealthRecords),
  healthController.getBcsRecords
);

router.post(
  '/bcs-records',
  authorize('Admin', 'Manager', 'Employee'),
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
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.createHoofRecord),
  healthController.createHoofRecord
);

router.post(
  '/hoof-records/bulk',
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.bulkCreateHoofRecords),
  healthController.bulkCreateHoofRecords
);

router.put(
  '/hoof-records/:id',
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.updateHoofRecord),
  healthController.updateHoofRecord
);

router.delete(
  '/hoof-records/:id',
  authorize('Admin', 'Manager'),
  healthController.deleteHoofRecord
);

// ============ SHEARING RECORDS ============
router.get(
  '/shearing-records',
  validate(healthValidation.getHealthRecords),
  healthController.getShearingRecords
);

router.post(
  '/shearing-records',
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.createShearingRecord),
  healthController.createShearingRecord
);

router.post(
  '/shearing-records/bulk',
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.bulkCreateShearingRecords),
  healthController.bulkCreateShearingRecords
);

router.put(
  '/shearing-records/:id',
  authorize('Admin', 'Manager', 'Employee'),
  validate(healthValidation.updateShearingRecord),
  healthController.updateShearingRecord
);

router.delete(
  '/shearing-records/:id',
  authorize('Admin', 'Manager'),
  healthController.deleteShearingRecord
);

module.exports = router;
