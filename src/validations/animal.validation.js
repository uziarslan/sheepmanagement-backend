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

const updateAnimal = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
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
    purchasePrice: Joi.number().min(0),
    buyingWeight: Joi.number().min(0),
    weight: Joi.number().min(0),
    weightDate: Joi.date(),
    pen: Joi.string().hex().length(24).allow(null),
    status: Joi.string().valid(...ANIMAL_STATUSES),
    pedigreeInfo: Joi.boolean(),
    sire: Joi.string().hex().length(24).allow(null),
    dam: Joi.string().hex().length(24).allow(null),
    notes: Joi.string().max(1000).allow('', null),
    soldDate: Joi.date().allow(null),
    soldPrice: Joi.number().min(0).allow(null),
    deathDate: Joi.date().allow(null),
    deathReason: Joi.string().allow('', null)
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
        buyingWeight: Joi.number().min(0).allow(null),
        weight: Joi.number().required().min(0),
        pen: Joi.string().hex().length(24).allow(null),
        status: Joi.string().valid(...ANIMAL_STATUSES).default('Active'),
        pedigreeInfo: Joi.boolean().default(false)
      })
    ).min(1).required()
  })
};

const getAnimals = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
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

module.exports = {
  createAnimal,
  updateAnimal,
  bulkCreate,
  getAnimals
};
