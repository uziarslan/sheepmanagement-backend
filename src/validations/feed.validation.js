const Joi = require('joi');

const createRecipe = {
  body: Joi.object().keys({
    name: Joi.string().required().max(200).trim(),
    description: Joi.string().max(1000).allow('', null),
    pen: Joi.string().hex().length(24).required(),
    penName: Joi.string(),
    ingredients: Joi.array().items(
      Joi.object().keys({
        stock: Joi.string().hex().length(24).required(),
        name: Joi.string(),
        unit: Joi.string(),
        ratePerUnit: Joi.number(),
        currentStock: Joi.number(),
        quantity: Joi.number().required().min(0.001),
        total: Joi.number()
      })
    ).min(1).required()
  })
};

const updateRecipe = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  body: Joi.object().keys({
    name: Joi.string().max(200).trim(),
    description: Joi.string().max(1000).allow('', null),
    pen: Joi.string().hex().length(24),
    penName: Joi.string(),
    ingredients: Joi.array().items(
      Joi.object().keys({
        stock: Joi.string().hex().length(24).required(),
        name: Joi.string(),
        unit: Joi.string(),
        ratePerUnit: Joi.number(),
        currentStock: Joi.number(),
        quantity: Joi.number().required().min(0.001),
        total: Joi.number()
      })
    ).min(1),
    isActive: Joi.boolean()
  }).min(1)
};

// Apply accepts either single `pen` (back-compat) OR `pens` array (multi-pen
// mode). At least one of the two must be present.
const applyRecipe = {
  body: Joi.object().keys({
    recipe: Joi.string().hex().length(24).required(),
    recipeName: Joi.string(),
    pen: Joi.string().hex().length(24),
    pens: Joi.array().items(Joi.string().hex().length(24)).min(1).max(50),
    penName: Joi.string(),
    date: Joi.date().default(Date.now),
    animalCount: Joi.number().integer().min(0),
    ingredients: Joi.array().items(
      Joi.object().keys({
        stock: Joi.string().hex().length(24),
        name: Joi.string(),
        unit: Joi.string(),
        quantity: Joi.number(),
        rate: Joi.number(),
        total: Joi.number()
      })
    ),
    totalCost: Joi.number().min(0),
    costPerAnimal: Joi.number().min(0),
    notes: Joi.string().max(1000).allow('', null)
  }).or('pen', 'pens')
};

// Range form mirrors applyRecipe but with date bounds instead of a single date.
const applyRecipeRange = {
  body: Joi.object().keys({
    recipe: Joi.string().hex().length(24).required(),
    pen: Joi.string().hex().length(24),
    pens: Joi.array().items(Joi.string().hex().length(24)).min(1).max(50),
    dateStart: Joi.date().required(),
    dateEnd: Joi.date().required(),
    notes: Joi.string().max(1000).allow('', null)
  }).or('pen', 'pens')
};

const getRecipes = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    sort: Joi.string(),
    search: Joi.string(),
    pen: Joi.string().hex().length(24),
    isActive: Joi.boolean()
  })
};

const getApplications = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    sort: Joi.string(),
    recipe: Joi.string().hex().length(24),
    pen: Joi.string().hex().length(24),
    startDate: Joi.date(),
    endDate: Joi.date()
  })
};

module.exports = {
  createRecipe,
  updateRecipe,
  applyRecipe,
  applyRecipeRange,
  getRecipes,
  getApplications
};
