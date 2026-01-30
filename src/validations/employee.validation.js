const Joi = require('joi');
const { DEPARTMENTS, DESIGNATIONS, BANKS, EMPLOYEE_STATUSES } = require('../constants');

const cnicRegex = /^\d{5}-\d{7}-\d{1}$/;

const createEmployee = {
  body: Joi.object().keys({
    name: Joi.string().required().max(100).trim(),
    cnic: Joi.string().required().pattern(cnicRegex)
      .messages({ 'string.pattern.base': 'CNIC must be in format: 35201-1234567-1' }),
    phone: Joi.string().required().trim(),
    email: Joi.string().email().lowercase().trim().allow('', null),
    address: Joi.string().max(500).trim().allow('', null),
    designation: Joi.string().required().valid(...DESIGNATIONS),
    department: Joi.string().required().valid(...DEPARTMENTS),
    dateOfJoining: Joi.date().required(),
    salary: Joi.number().required().min(0),
    allowances: Joi.number().min(0).default(0),
    bankName: Joi.string().valid(...BANKS, '').allow('', null),
    accountNumber: Joi.string().trim().allow('', null),
    emergencyContact: Joi.object().keys({
      name: Joi.string().trim().allow('', null),
      phone: Joi.string().trim().allow('', null),
      relation: Joi.string().trim().allow('', null)
    }).allow(null),
    notes: Joi.string().max(1000).allow('', null)
  })
};

const updateEmployee = {
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required()
  }),
  body: Joi.object().keys({
    name: Joi.string().max(100).trim(),
    cnic: Joi.string().pattern(cnicRegex)
      .messages({ 'string.pattern.base': 'CNIC must be in format: 35201-1234567-1' }),
    phone: Joi.string().trim(),
    email: Joi.string().email().lowercase().trim().allow('', null),
    address: Joi.string().max(500).trim().allow('', null),
    designation: Joi.string().valid(...DESIGNATIONS),
    department: Joi.string().valid(...DEPARTMENTS),
    dateOfJoining: Joi.date(),
    dateOfLeaving: Joi.date().allow(null),
    salary: Joi.number().min(0),
    allowances: Joi.number().min(0),
    bankName: Joi.string().valid(...BANKS, '').allow('', null),
    accountNumber: Joi.string().trim().allow('', null),
    status: Joi.string().valid(...EMPLOYEE_STATUSES),
    emergencyContact: Joi.object().keys({
      name: Joi.string().trim().allow('', null),
      phone: Joi.string().trim().allow('', null),
      relation: Joi.string().trim().allow('', null)
    }).allow(null),
    notes: Joi.string().max(1000).allow('', null)
  }).min(1)
};

const getEmployees = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sort: Joi.string(),
    search: Joi.string(),
    department: Joi.string().valid(...DEPARTMENTS),
    designation: Joi.string().valid(...DESIGNATIONS),
    status: Joi.string().valid(...EMPLOYEE_STATUSES)
  })
};

module.exports = {
  createEmployee,
  updateEmployee,
  getEmployees
};
