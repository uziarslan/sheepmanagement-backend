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
  // BCS Records
  getBcsRecords,
  createBcsRecord,
  // Hoof Records
  getHoofRecords,
  createHoofRecord,
  updateHoofRecord,
  deleteHoofRecord,
  // Cure Tracking
  getCureTracking
};
