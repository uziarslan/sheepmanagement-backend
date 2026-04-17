const { healthService } = require('../services');
const { asyncHandler, successResponse } = require('../utils');
const { HTTP_STATUS } = require('../constants');

// ============ VACCINATION CONTROLLERS ============

const getVaccinations = asyncHandler(async (req, res) => {
  const result = await healthService.getVaccinations(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Vaccinations retrieved successfully', result.meta)
  );
});

const createVaccination = asyncHandler(async (req, res) => {
  const vaccination = await healthService.createVaccination(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(vaccination, 'Vaccination recorded successfully')
  );
});

const deleteVaccination = asyncHandler(async (req, res) => {
  await healthService.deleteVaccination(req.params.id, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Vaccination record deleted successfully')
  );
});

// ============ TREATMENT CONTROLLERS ============

const getTreatments = asyncHandler(async (req, res) => {
  const result = await healthService.getTreatments(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Treatments retrieved successfully', result.meta)
  );
});

const createTreatment = asyncHandler(async (req, res) => {
  const treatment = await healthService.createTreatment(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(treatment, 'Treatment recorded successfully')
  );
});

const updateTreatment = asyncHandler(async (req, res) => {
  const treatment = await healthService.updateTreatment(req.params.id, req.body, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(treatment, 'Treatment updated successfully')
  );
});

const deleteTreatment = asyncHandler(async (req, res) => {
  await healthService.deleteTreatment(req.params.id, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Treatment record deleted successfully')
  );
});

// ============ DEWORMING CONTROLLERS ============

const getDewormings = asyncHandler(async (req, res) => {
  const result = await healthService.getDewormings(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Dewormings retrieved successfully', result.meta)
  );
});

const createDeworming = asyncHandler(async (req, res) => {
  const deworming = await healthService.createDeworming(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(deworming, 'Deworming recorded successfully')
  );
});

const deleteDeworming = asyncHandler(async (req, res) => {
  await healthService.deleteDeworming(req.params.id, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Deworming record deleted successfully')
  );
});

// ============ WEIGHT RECORD CONTROLLERS ============

const getWeightRecords = asyncHandler(async (req, res) => {
  const result = await healthService.getWeightRecords(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Weight records retrieved successfully', result.meta)
  );
});

const createWeightRecord = asyncHandler(async (req, res) => {
  const record = await healthService.createWeightRecord(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(record, 'Weight recorded successfully')
  );
});

const bulkCreateWeightRecords = asyncHandler(async (req, res) => {
  const result = await healthService.bulkCreateWeightRecords(req.body.records, req.user.id);

  res.status(HTTP_STATUS.CREATED).json(
    successResponse(result, `${result.created.length} weight record(s) created, ${result.errors.length} failed`)
  );
});

// ============ TEMPERATURE RECORD CONTROLLERS ============

const getTemperatureRecords = asyncHandler(async (req, res) => {
  const result = await healthService.getTemperatureRecords(req.query);

  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Temperature records retrieved successfully', result.meta)
  );
});

const createTemperatureRecord = asyncHandler(async (req, res) => {
  const record = await healthService.createTemperatureRecord(req.body, req.user.id);

  res.status(HTTP_STATUS.CREATED).json(
    successResponse(record, 'Temperature recorded successfully')
  );
});

const bulkCreateTemperatureRecords = asyncHandler(async (req, res) => {
  const result = await healthService.bulkCreateTemperatureRecords(req.body.records, req.user.id);

  res.status(HTTP_STATUS.CREATED).json(
    successResponse(result, `${result.created.length} temperature record(s) created, ${result.errors.length} failed`)
  );
});

// ============ BCS RECORD CONTROLLERS ============

const getBcsRecords = asyncHandler(async (req, res) => {
  const result = await healthService.getBcsRecords(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'BCS records retrieved successfully', result.meta)
  );
});

const createBcsRecord = asyncHandler(async (req, res) => {
  const record = await healthService.createBcsRecord(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(record, 'BCS recorded successfully')
  );
});

// ============ HOOF RECORD CONTROLLERS ============

const getHoofRecords = asyncHandler(async (req, res) => {
  const result = await healthService.getHoofRecords(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Hoof records retrieved successfully', result.meta)
  );
});

const createHoofRecord = asyncHandler(async (req, res) => {
  const record = await healthService.createHoofRecord(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(record, 'Hoof record created successfully')
  );
});

const bulkCreateHoofRecords = asyncHandler(async (req, res) => {
  const result = await healthService.bulkCreateHoofRecords(req.body, req.user.id);

  res.status(HTTP_STATUS.CREATED).json(
    successResponse(result, `${result.created.length} hoof record(s) created, ${result.errors.length} failed`)
  );
});

const updateHoofRecord = asyncHandler(async (req, res) => {
  const record = await healthService.updateHoofRecord(req.params.id, req.body, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(record, 'Hoof record updated successfully')
  );
});

const deleteHoofRecord = asyncHandler(async (req, res) => {
  await healthService.deleteHoofRecord(req.params.id, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Hoof record deleted successfully')
  );
});

// ============ SHEARING RECORD CONTROLLERS ============

const getShearingRecords = asyncHandler(async (req, res) => {
  const result = await healthService.getShearingRecords(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Shearing records retrieved successfully', result.meta)
  );
});

const createShearingRecord = asyncHandler(async (req, res) => {
  const record = await healthService.createShearingRecord(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(record, 'Shearing record created successfully')
  );
});

const bulkCreateShearingRecords = asyncHandler(async (req, res) => {
  const result = await healthService.bulkCreateShearingRecords(req.body, req.user.id);

  res.status(HTTP_STATUS.CREATED).json(
    successResponse(result, `${result.created.length} shearing record(s) created, ${result.errors.length} failed`)
  );
});

const updateShearingRecord = asyncHandler(async (req, res) => {
  const record = await healthService.updateShearingRecord(req.params.id, req.body, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(record, 'Shearing record updated successfully')
  );
});

const deleteShearingRecord = asyncHandler(async (req, res) => {
  await healthService.deleteShearingRecord(req.params.id, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Shearing record deleted successfully')
  );
});

// ============ CURE TRACKING CONTROLLER ============

const getCureTracking = asyncHandler(async (req, res) => {
  const result = await healthService.getCureTracking(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result, 'Cure tracking data retrieved successfully')
  );
});

module.exports = {
  // Vaccination
  getVaccinations,
  createVaccination,
  deleteVaccination,
  // Treatment
  getTreatments,
  createTreatment,
  updateTreatment,
  deleteTreatment,
  // Deworming
  getDewormings,
  createDeworming,
  deleteDeworming,
  // Weight Records
  getWeightRecords,
  createWeightRecord,
  bulkCreateWeightRecords,
  // Temperature Records
  getTemperatureRecords,
  createTemperatureRecord,
  bulkCreateTemperatureRecords,
  // BCS Records
  getBcsRecords,
  createBcsRecord,
  // Hoof Records
  getHoofRecords,
  createHoofRecord,
  bulkCreateHoofRecords,
  updateHoofRecord,
  deleteHoofRecord,
  // Shearing Records
  getShearingRecords,
  createShearingRecord,
  bulkCreateShearingRecords,
  updateShearingRecord,
  deleteShearingRecord,
  // Cure Tracking
  getCureTracking
};
