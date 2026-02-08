const { vaccinationService } = require('../services');
const { asyncHandler, successResponse } = require('../utils');
const { HTTP_STATUS } = require('../constants');

// ============ VACCINE CONTROLLERS ============

/**
 * Get all vaccines
 * GET /api/vaccination/vaccines
 */
const getAllVaccines = asyncHandler(async (req, res) => {
  const result = await vaccinationService.getAllVaccines(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Vaccines retrieved successfully', result.meta)
  );
});

/**
 * Get vaccine by ID
 * GET /api/vaccination/vaccines/:id
 */
const getVaccineById = asyncHandler(async (req, res) => {
  const vaccine = await vaccinationService.getVaccineById(req.params.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(vaccine, 'Vaccine retrieved successfully')
  );
});

/**
 * Create vaccine
 * POST /api/vaccination/vaccines
 */
const createVaccine = asyncHandler(async (req, res) => {
  const vaccine = await vaccinationService.createVaccine(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(vaccine, 'Vaccine created successfully')
  );
});

/**
 * Update vaccine
 * PUT /api/vaccination/vaccines/:id
 */
const updateVaccine = asyncHandler(async (req, res) => {
  const vaccine = await vaccinationService.updateVaccine(req.params.id, req.body, req.user.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(vaccine, 'Vaccine updated successfully')
  );
});

/**
 * Delete vaccine
 * DELETE /api/vaccination/vaccines/:id
 */
const deleteVaccine = asyncHandler(async (req, res) => {
  await vaccinationService.deleteVaccine(req.params.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Vaccine deleted successfully')
  );
});

// ============ APPLICATION CONTROLLERS ============

/**
 * Get all applications
 * GET /api/vaccination/applications
 */
const getApplications = asyncHandler(async (req, res) => {
  const result = await vaccinationService.getApplications(req.query);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(result.data, 'Vaccination applications retrieved successfully', result.meta)
  );
});

/**
 * Apply vaccine
 * POST /api/vaccination/applications
 */
const applyVaccine = asyncHandler(async (req, res) => {
  const application = await vaccinationService.applyVaccine(req.body, req.user.id);
  
  res.status(HTTP_STATUS.CREATED).json(
    successResponse(application, 'Vaccine applied successfully')
  );
});

/**
 * Get application by ID
 * GET /api/vaccination/applications/:id
 */
const getApplicationById = asyncHandler(async (req, res) => {
  const application = await vaccinationService.getApplicationById(req.params.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(application, 'Vaccination application retrieved successfully')
  );
});

/**
 * Delete application
 * DELETE /api/vaccination/applications/:id
 */
const deleteApplication = asyncHandler(async (req, res) => {
  await vaccinationService.deleteApplication(req.params.id);
  
  res.status(HTTP_STATUS.OK).json(
    successResponse(null, 'Vaccination application deleted successfully')
  );
});

module.exports = {
  getAllVaccines,
  getVaccineById,
  createVaccine,
  updateVaccine,
  deleteVaccine,
  getApplications,
  applyVaccine,
  getApplicationById,
  deleteApplication
};
