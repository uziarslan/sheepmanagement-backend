const Joi = require('joi');
const { STOCK_CATEGORIES, STOCK_UNITS, ASSET_TYPES } = require('../constants');

const createStock = {
  body: Joi.object().keys({
    productName: Joi.string().required().max(200).trim(),
    category: Joi.string().required().valid(...STOCK_CATEGORIES),
    assetType: Joi.string().valid(...ASSET_TYPES).allow(null, ''),
    unit: Joi.string().required().valid(...STOCK_UNITS),
    isStockItem: Joi.boolean().default(true),
    purchaseDate: Joi.date().allow(null),
    packQuantity: Joi.number().min(0),
    unitSize: Joi.number().min(0),
    totalQuantity: Joi.number().min(0),
    totalPrice: Joi.number().min(0),
    transportation: Joi.number().min(0).allow(null),
    loadingUnloading: Joi.number().min(0).allow(null),
    costPerUnit: Joi.number().min(0),
    openingStockQty: Joi.number().required().min(0),
    openingRatePerUnit: Joi.number().required().min(0),
    minStockLevel: Joi.number().min(0).default(0),
    supplier: Joi.string().trim().allow('', null),
    expiryDate: Joi.date().allow(null),
    batchNumber: Joi.string().trim().allow('', null),
    storageLocation: Joi.string().trim().allow('', null),
    notes: Joi.string().max(500).allow('', null)
  })
};

const updateStock = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  body: Joi.object().keys({
    productName: Joi.string().max(200).trim(),
    category: Joi.string().valid(...STOCK_CATEGORIES),
    assetType: Joi.string().valid(...ASSET_TYPES).allow(null, ''),
    unit: Joi.string().valid(...STOCK_UNITS),
    isStockItem: Joi.boolean(),
    purchaseDate: Joi.date().allow(null),
    packQuantity: Joi.number().min(0),
    unitSize: Joi.number().min(0),
    totalQuantity: Joi.number().min(0),
    totalPrice: Joi.number().min(0),
    costPerUnit: Joi.number().min(0),
    openingStockQty: Joi.number().min(0),
    openingRatePerUnit: Joi.number().min(0),
    currentQty: Joi.number().min(0),
    minStockLevel: Joi.number().min(0),
    supplier: Joi.string().trim().allow('', null),
    expiryDate: Joi.date().allow(null),
    batchNumber: Joi.string().trim().allow('', null),
    storageLocation: Joi.string().trim().allow('', null),
    notes: Joi.string().max(500).allow('', null),
    isActive: Joi.boolean()
  }).min(1)
};

const getStocks = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(100),
    sort: Joi.string(),
    search: Joi.string(),
    category: Joi.string().valid(...STOCK_CATEGORIES),
    isActive: Joi.boolean(),
    lowStock: Joi.boolean()
  })
};

const adjustStock = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  body: Joi.object().keys({
    quantity: Joi.number().required(),
    type: Joi.string().required().valid('add', 'deduct'),
    reason: Joi.string().max(500).allow('', null)
  })
};

module.exports = {
  createStock,
  updateStock,
  getStocks,
  adjustStock
};
