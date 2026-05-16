const Joi = require('joi');
const {
  VACCINATION_SCOPES,
  TREATMENT_TYPES,
  DIAGNOSIS_TYPES,
  DEWORMING_SCOPES,
  DEWORMING_TYPES,
  CURE_STATUSES,
  HOOF_DIAGNOSIS,
  SHEARING_TYPES,
  BCS_VALUES
} = require('../constants');

// Vaccination validations
const createVaccination = {
  body: Joi.object().keys({
    date: Joi.date().default(Date.now),
    scope: Joi.string().required().valid(...VACCINATION_SCOPES),
    pen: Joi.string().hex().length(24).when('scope', {
      is: 'Pen',
      then: Joi.required(),
      otherwise: Joi.allow(null)
    }),
    animal: Joi.string().hex().length(24).when('scope', {
      is: 'Individual',
      then: Joi.required(),
      otherwise: Joi.allow(null)
    }),
    medicines: Joi.array().items(
      Joi.object().keys({
        medicine: Joi.string().hex().length(24).required(),
        medicineName: Joi.string(),
        packSize: Joi.number(),
        currentQty: Joi.number(),
        quantity: Joi.number().required().min(0.1),
        unit: Joi.string(),
        rate: Joi.number(),
        total: Joi.number()
      })
    ).min(1).required(),
    technician: Joi.string().hex().length(24).allow(null),
    technicianName: Joi.string().allow('', null),
    comments: Joi.string().max(1000).allow('', null)
  })
};

// Treatment validations
const createTreatment = {
  body: Joi.object().keys({
    date: Joi.date().default(Date.now),
    animal: Joi.string().hex().length(24).required(),
    animalTagId: Joi.string(),
    animalName: Joi.string(),
    findings: Joi.string().max(1000).allow('', null),
    type: Joi.string().required().valid(...TREATMENT_TYPES),
    diagnosis: Joi.string().required().valid(...DIAGNOSIS_TYPES),
    medicines: Joi.array().items(
      Joi.object().keys({
        medicine: Joi.string().hex().length(24).required(),
        medicineName: Joi.string(),
        rate: Joi.number(),
        unit: Joi.string(),
        quantity: Joi.number().required().min(0.1),
        total: Joi.number()
      })
    ),
    duration: Joi.number().integer().min(1),
    cureStatus: Joi.string().valid(...CURE_STATUSES).default('In Treatment'),
    followUpDate: Joi.date().allow(null),
    veterinarian: Joi.string().hex().length(24).allow(null),
    veterinarianName: Joi.string().allow('', null),
    comments: Joi.string().max(1000).allow('', null)
  })
};

const updateTreatment = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  body: Joi.object().keys({
    cureStatus: Joi.string().valid(...CURE_STATUSES),
    curedDate: Joi.date(),
    followUpDate: Joi.date().allow(null),
    comments: Joi.string().max(1000).allow('', null)
  }).min(1)
};

// Deworming validations
const createDeworming = {
  body: Joi.object().keys({
    date: Joi.date().default(Date.now),
    scope: Joi.string().required().valid(...DEWORMING_SCOPES),
    pen: Joi.string().hex().length(24).when('scope', {
      is: 'Shed',
      then: Joi.required(),
      otherwise: Joi.allow(null)
    }),
    penName: Joi.string(),
    animal: Joi.string().hex().length(24).when('scope', {
      is: 'Individual Animal',
      then: Joi.required(),
      otherwise: Joi.allow(null)
    }),
    animalTagId: Joi.string(),
    dewormingType: Joi.string().required().valid(...DEWORMING_TYPES),
    technician: Joi.string().hex().length(24).allow(null),
    technicianName: Joi.string().allow('', null),
    medicines: Joi.array().items(
      Joi.object().keys({
        medicine: Joi.string().hex().length(24).required(),
        medicineName: Joi.string(),
        quantity: Joi.number().required().min(0.1),
        unit: Joi.string(),
        rate: Joi.number(),
        total: Joi.number()
      })
    ),
    nextDueDate: Joi.date().allow(null),
    comments: Joi.string().max(1000).allow('', null)
  })
};

// Weight Record validations
const createWeightRecord = {
  body: Joi.object().keys({
    animal: Joi.string().hex().length(24).required(),
    animalTagId: Joi.string(),
    animalName: Joi.string(),
    date: Joi.date().default(Date.now),
    weight: Joi.number().required().min(0.1),
    notes: Joi.string().max(500).allow('', null)
  })
};

// Temperature Record validations
const createTemperatureRecord = {
  body: Joi.object().keys({
    animal: Joi.string().hex().length(24).required(),
    animalTagId: Joi.string(),
    animalName: Joi.string(),
    date: Joi.date().default(Date.now),
    temperature: Joi.number().required().min(20).max(50),
    notes: Joi.string().max(500).allow('', null)
  })
};

// BCS Record validations
const createBcsRecord = {
  body: Joi.object().keys({
    animal: Joi.string().hex().length(24).required(),
    animalTagId: Joi.string(),
    animalName: Joi.string(),
    date: Joi.date().default(Date.now),
    bcsScore: Joi.number().required().valid(...BCS_VALUES),
    lastCalving: Joi.date().allow(null),
    lactationNo: Joi.number().integer().min(0).allow(null),
    dimAge: Joi.number().integer().min(0).allow(null),
    notes: Joi.string().max(500).allow('', null)
  })
};

// Hoof Record validations
const createHoofRecord = {
  body: Joi.object().keys({
    animal: Joi.string().hex().length(24).required(),
    animalTagId: Joi.string(),
    animalName: Joi.string(),
    date: Joi.date().default(Date.now),
    technician: Joi.string().hex().length(24).allow(null),
    technicianName: Joi.string().allow('', null),
    diagnosis: Joi.string().required().valid(...HOOF_DIAGNOSIS),
    hoofDetails: Joi.array().items(
      Joi.object().keys({
        position: Joi.string().required().valid('Front Left', 'Front Right', 'Rear Left', 'Rear Right'),
        condition: Joi.string().valid('Normal', 'Mild Issue', 'Moderate Issue', 'Severe Issue').default('Normal'),
        trimmed: Joi.boolean().default(false),
        notes: Joi.string().allow('', null)
      })
    ),
    cost: Joi.number().min(0).default(0),
    treatmentApplied: Joi.string().allow('', null),
    nextCheckupDate: Joi.date().allow(null),
    comments: Joi.string().max(1000).allow('', null)
  })
};

const bulkCreateHoofRecords = {
  body: Joi.object().keys({
    animals: Joi.array().items(Joi.string().hex().length(24)).min(1).max(500).required(),
    date: Joi.date().default(Date.now),
    technician: Joi.string().hex().length(24).allow(null),
    technicianName: Joi.string().allow('', null),
    diagnosis: Joi.string().required().valid(...HOOF_DIAGNOSIS),
    hoofDetails: Joi.array().items(
      Joi.object().keys({
        position: Joi.string().required().valid('Front Left', 'Front Right', 'Rear Left', 'Rear Right'),
        condition: Joi.string().valid('Normal', 'Mild Issue', 'Moderate Issue', 'Severe Issue').default('Normal'),
        trimmed: Joi.boolean().default(false),
        notes: Joi.string().allow('', null)
      })
    ),
    cost: Joi.number().min(0).default(0),
    treatmentApplied: Joi.string().allow('', null),
    comments: Joi.string().max(1000).allow('', null)
  })
};

const updateHoofRecord = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  body: Joi.object().keys({
    hoofDetails: Joi.array().items(
      Joi.object().keys({
        position: Joi.string().required().valid('Front Left', 'Front Right', 'Rear Left', 'Rear Right'),
        condition: Joi.string().valid('Normal', 'Mild Issue', 'Moderate Issue', 'Severe Issue'),
        trimmed: Joi.boolean(),
        notes: Joi.string().allow('', null)
      })
    ),
    cost: Joi.number().min(0),
    treatmentApplied: Joi.string().allow('', null),
    nextCheckupDate: Joi.date().allow(null),
    comments: Joi.string().max(1000).allow('', null)
  }).min(1)
};

// Shearing Record validations
const createShearingRecord = {
  body: Joi.object().keys({
    animal: Joi.string().hex().length(24).required(),
    animalTagId: Joi.string(),
    animalName: Joi.string(),
    date: Joi.date().default(Date.now),
    technician: Joi.string().hex().length(24).allow(null),
    technicianName: Joi.string().allow('', null),
    shearingType: Joi.string().required().valid(...SHEARING_TYPES),
    woolWeight: Joi.number().min(0).default(0),
    woolQuality: Joi.string().valid('Excellent', 'Good', 'Average', 'Poor').default('Good'),
    cost: Joi.number().min(0).default(0),
    nextShearingDate: Joi.date().allow(null),
    comments: Joi.string().max(1000).allow('', null)
  })
};

const bulkCreateShearingRecords = {
  body: Joi.object().keys({
    animals: Joi.array().items(Joi.string().hex().length(24)).min(1).max(500).required(),
    date: Joi.date().default(Date.now),
    technician: Joi.string().hex().length(24).allow(null),
    technicianName: Joi.string().allow('', null),
    shearingType: Joi.string().required().valid(...SHEARING_TYPES),
    woolWeight: Joi.number().min(0).default(0),
    woolQuality: Joi.string().valid('Excellent', 'Good', 'Average', 'Poor').default('Good'),
    cost: Joi.number().min(0).default(0),
    comments: Joi.string().max(1000).allow('', null)
  })
};

const updateShearingRecord = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  body: Joi.object().keys({
    shearingType: Joi.string().valid(...SHEARING_TYPES),
    woolWeight: Joi.number().min(0),
    woolQuality: Joi.string().valid('Excellent', 'Good', 'Average', 'Poor'),
    cost: Joi.number().min(0),
    nextShearingDate: Joi.date().allow(null),
    comments: Joi.string().max(1000).allow('', null)
  }).min(1)
};

// Bulk Weight Record validations
const bulkCreateWeightRecords = {
  body: Joi.object().keys({
    records: Joi.array().items(
      Joi.object().keys({
        animal: Joi.string().hex().length(24).required(),
        animalTagId: Joi.string(),
        animalName: Joi.string(),
        date: Joi.date().default(Date.now),
        weight: Joi.number().required().min(0.1),
        notes: Joi.string().max(500).allow('', null)
      })
    ).min(1).max(500).required()
  })
};

// Bulk Temperature Record validations
const bulkCreateTemperatureRecords = {
  body: Joi.object().keys({
    records: Joi.array().items(
      Joi.object().keys({
        animal: Joi.string().hex().length(24).required(),
        animalTagId: Joi.string(),
        animalName: Joi.string(),
        date: Joi.date().default(Date.now),
        temperature: Joi.number().required().min(20).max(50),
        notes: Joi.string().max(500).allow('', null)
      })
    ).min(1).max(500).required()
  })
};

// Query validations for health records
const getHealthRecords = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    sort: Joi.string(),
    animal: Joi.string().hex().length(24),
    pen: Joi.string().hex().length(24),
    startDate: Joi.date(),
    endDate: Joi.date(),
    cureStatus: Joi.string().valid(...CURE_STATUSES, 'Both')
  })
};

module.exports = {
  createVaccination,
  createTreatment,
  updateTreatment,
  createDeworming,
  createWeightRecord,
  createTemperatureRecord,
  bulkCreateWeightRecords,
  bulkCreateTemperatureRecords,
  createBcsRecord,
  createHoofRecord,
  bulkCreateHoofRecords,
  updateHoofRecord,
  createShearingRecord,
  bulkCreateShearingRecords,
  updateShearingRecord,
  getHealthRecords
};
