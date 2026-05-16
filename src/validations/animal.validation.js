const Joi = require('joi');
const {
  ANIMAL_TYPES,
  BREED_TYPES,
  ANIMAL_SUBCATEGORIES,
  SEX_OPTIONS,
  COUNTRIES,
  ANIMAL_STATUSES
} = require('../constants');

const createAnimal = {
  body: Joi.object().keys({
    tagId: Joi.string().trim().uppercase(),
    electronicId: Joi.string().trim().allow('', null),
    name: Joi.string().max(100).trim().allow('', null),
    animalType: Joi.string().required().valid(...ANIMAL_TYPES),
    breedType: Joi.string().required().valid(...BREED_TYPES),
    subcategory: Joi.string().required().valid(...ANIMAL_SUBCATEGORIES),
    sex: Joi.string().required().valid(...SEX_OPTIONS),
    purchasedFrom: Joi.string().valid(...COUNTRIES).default('Pakistan'),
    arrivalDate: Joi.date().required(),
    birthDate: Joi.date().allow(null),
    purchasePrice: Joi.number().required().min(0),
    purchaseTransport: Joi.number().min(0).allow(null),
    purchaseMandiExpenses: Joi.number().min(0).allow(null),
    purchaseFuel: Joi.number().min(0).allow(null),
    purchaseFood: Joi.number().min(0).allow(null),
    purchaseHotel: Joi.number().min(0).allow(null),
    buyingWeight: Joi.number().min(0).allow(null),
    weight: Joi.number().required().min(0),
    weightDate: Joi.date().default(Date.now),
    pen: Joi.string().hex().length(24).allow(null),
    status: Joi.string().valid(...ANIMAL_STATUSES).default('Active'),
    pedigreeInfo: Joi.boolean().default(false),
    sire: Joi.string().hex().length(24).allow(null),
    dam: Joi.string().hex().length(24).allow(null),
    notes: Joi.string().max(1000).allow('', null)
  })
};

// Statuses settable via the generic update endpoint.
// 'Sold', 'Dead', 'Slaughtered' must go through their dedicated endpoints
// (mark-sold / declare-dead) so capital and loss/profit are tracked correctly.
const UPDATABLE_STATUSES = ANIMAL_STATUSES.filter(
  (s) => !['Sold', 'Dead', 'Slaughtered'].includes(s)
);

const updateAnimal = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  // NOTE: lifecycle fields (status: Sold/Dead/Slaughtered, soldDate, soldPrice,
  // deathDate, deathReason) and purchase-cost fields (purchasePrice,
  // purchaseTransport, purchaseMandiExpenses, purchaseFuel, purchaseFood,
  // purchaseHotel) are intentionally NOT accepted here. Lifecycle changes go
  // through mark-sold / declare-dead. Purchase-cost edits require a synced
  // capital adjustment, which isn't supported yet — block at the boundary.
  body: Joi.object().keys({
    tagId: Joi.string().trim().uppercase(),
    electronicId: Joi.string().trim().allow('', null),
    name: Joi.string().max(100).trim().allow('', null),
    animalType: Joi.string().valid(...ANIMAL_TYPES),
    breedType: Joi.string().valid(...BREED_TYPES),
    subcategory: Joi.string().valid(...ANIMAL_SUBCATEGORIES),
    sex: Joi.string().valid(...SEX_OPTIONS),
    purchasedFrom: Joi.string().valid(...COUNTRIES),
    arrivalDate: Joi.date(),
    birthDate: Joi.date().allow(null),
    buyingWeight: Joi.number().min(0),
    weight: Joi.number().min(0),
    weightDate: Joi.date(),
    pen: Joi.string().hex().length(24).allow(null),
    status: Joi.string().valid(...UPDATABLE_STATUSES),
    pedigreeInfo: Joi.boolean(),
    sire: Joi.string().hex().length(24).allow(null),
    dam: Joi.string().hex().length(24).allow(null),
    notes: Joi.string().max(1000).allow('', null)
  }).min(1)
};

const bulkCreate = {
  body: Joi.object().keys({
    animals: Joi.array().items(
      Joi.object().keys({
        tagId: Joi.string().trim().uppercase(),
        electronicId: Joi.string().trim().allow('', null),
        name: Joi.string().max(100).trim().allow('', null),
        animalType: Joi.string().required().valid(...ANIMAL_TYPES),
        breedType: Joi.string().required().valid(...BREED_TYPES),
        subcategory: Joi.string().required().valid(...ANIMAL_SUBCATEGORIES),
        sex: Joi.string().required().valid(...SEX_OPTIONS),
        purchasedFrom: Joi.string().valid(...COUNTRIES).default('Pakistan'),
        arrivalDate: Joi.date().required(),
        birthDate: Joi.date().allow(null),
        purchasePrice: Joi.number().required().min(0),
        purchaseTransport: Joi.number().min(0).allow(null),
        purchaseMandiExpenses: Joi.number().min(0).allow(null),
        purchaseFuel: Joi.number().min(0).allow(null),
        purchaseFood: Joi.number().min(0).allow(null),
        purchaseHotel: Joi.number().min(0).allow(null),
        buyingWeight: Joi.number().min(0).allow(null),
        weight: Joi.number().required().min(0),
        weightDate: Joi.date().default(Date.now),
        pen: Joi.string().hex().length(24).allow(null),
        status: Joi.string().valid(...ANIMAL_STATUSES).default('Active'),
        pedigreeInfo: Joi.boolean().default(false),
        sire: Joi.string().hex().length(24).allow(null),
        dam: Joi.string().hex().length(24).allow(null),
        notes: Joi.string().max(1000).allow('', null)
      })
    ).min(1).required()
  })
};

const getAnimals = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    // Cap raised to 5000 (was 100) so selection UIs (apply-vaccine pen-wide
    // and all-animals scopes, bulk-mark-sold, etc.) can fetch every animal
    // in one shot. Real farm rosters are tens-to-thousands, well within
    // this ceiling. Default stays at 10 for tables.
    limit: Joi.number().integer().min(1).max(5000).default(10),
    sort: Joi.string(),
    search: Joi.string(),
    status: Joi.string().valid(...ANIMAL_STATUSES),
    animalType: Joi.string().valid(...ANIMAL_TYPES),
    breedType: Joi.string().valid(...BREED_TYPES),
    subcategory: Joi.string().valid(...ANIMAL_SUBCATEGORIES),
    sex: Joi.string().valid(...SEX_OPTIONS),
    pen: Joi.string().hex().length(24)
  })
};

const getByTagIds = {
  body: Joi.object().keys({
    tagIds: Joi.array()
      .items(Joi.string().trim().uppercase())
      .min(1)
      .max(2000)
      .required()
  })
};

const moveToPen = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  body: Joi.object().keys({
    penId: Joi.string().hex().length(24).required()
  })
};

const declareDead = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  body: Joi.object().keys({
    deathDate: Joi.date().max('now').default(Date.now),
    deathReason: Joi.string().max(500).allow('', null)
  })
};

const markAsSold = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  body: Joi.object().keys({
    soldDate: Joi.date().max('now').default(Date.now),
    sellingPrice: Joi.number().required().min(0),
    sellingCost: Joi.number().min(0).default(0)
  })
};

const bulkMarkAsSold = {
  body: Joi.object().keys({
    animals: Joi.array().items(
      Joi.object().keys({
        animalId: Joi.string().hex().length(24),
        tagId: Joi.string().trim().uppercase(),
        soldDate: Joi.date().max('now'),
        sellingPrice: Joi.number().required().min(0),
        sellingCost: Joi.number().min(0).default(0)
      }).or('animalId', 'tagId')
    ).min(1).max(500).required()
  })
};

module.exports = {
  createAnimal,
  updateAnimal,
  bulkCreate,
  getAnimals,
  getByTagIds,
  moveToPen,
  declareDead,
  markAsSold,
  bulkMarkAsSold
};
