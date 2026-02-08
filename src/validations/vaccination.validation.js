const Joi = require('joi');

// ============ VACCINE RECIPE VALIDATIONS ============

const getVaccines = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sort: Joi.string(),
    search: Joi.string().trim(),
    disease: Joi.string().trim(),
    isActive: Joi.boolean()
  })
};

const createVaccine = {
  body: Joi.object({
    name: Joi.string().required().trim(),
    disease: Joi.string().required().trim(),
    description: Joi.string().trim(),
    medicines: Joi.array().min(1).items(
      Joi.object({
        medicine: Joi.string().hex().length(24).required(),
        quantity: Joi.number().min(0.1).required()
      })
    ).required(),
    dosageInstructions: Joi.string().trim(),
    nextDoseDays: Joi.number().min(0),
    isActive: Joi.boolean()
  })
};

const updateVaccine = {
  params: Joi.object({
    id: Joi.string().required().hex().length(24)
  }),
  body: Joi.object({
    name: Joi.string().trim(),
    disease: Joi.string().trim(),
    description: Joi.string().trim(),
    medicines: Joi.array().min(1).items(
      Joi.object({
        medicine: Joi.string().hex().length(24).required(),
        quantity: Joi.number().min(0.1).required()
      })
    ),
    dosageInstructions: Joi.string().trim(),
    nextDoseDays: Joi.number().min(0),
    isActive: Joi.boolean()
  })
};

// ============ APPLICATION VALIDATIONS ============

const getApplications = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sort: Joi.string(),
    search: Joi.string().trim(),
    scope: Joi.string().valid('Pen', 'Individual', 'Multiple'),
    pen: Joi.string().hex().length(24),
    animal: Joi.string().hex().length(24),
    vaccineRecipe: Joi.string().hex().length(24),
    dateFrom: Joi.date(),
    dateTo: Joi.date()
  })
};

const applyVaccine = {
  body: Joi.object({
    date: Joi.date().required(),
    vaccineRecipeId: Joi.string().hex().length(24).required(),
    scope: Joi.string().valid('Pen', 'Individual', 'Multiple').required(),
    pen: Joi.string().hex().length(24),
    animal: Joi.string().hex().length(24),
    animals: Joi.array().items(Joi.string().hex().length(24)),
    nextDueDate: Joi.date(),
    remarks: Joi.string().trim()
  })
};

module.exports = {
  getVaccines,
  createVaccine,
  updateVaccine,
  getApplications,
  applyVaccine
};
