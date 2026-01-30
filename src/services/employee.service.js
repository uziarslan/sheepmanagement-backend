const { Employee } = require('../models');
const { ApiError, getPaginationOptions, getSortOptions, getPaginationMeta } = require('../utils');

/**
 * Get all employees with filters
 */
const getAll = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || 'name');

  // Build filter
  const filter = {};
  if (query.department) filter.department = query.department;
  if (query.designation) filter.designation = query.designation;
  if (query.status) filter.status = query.status;

  // Search
  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { cnic: { $regex: query.search, $options: 'i' } },
      { phone: { $regex: query.search, $options: 'i' } }
    ];
  }

  const [employees, total] = await Promise.all([
    Employee.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Employee.countDocuments(filter)
  ]);

  return {
    data: employees,
    meta: getPaginationMeta(total, page, limit)
  };
};

/**
 * Get employee by ID
 */
const getById = async (id) => {
  const employee = await Employee.findById(id);

  if (!employee) {
    throw ApiError.notFound('Employee not found');
  }

  return employee;
};

/**
 * Create employee
 */
const create = async (employeeData, userId) => {
  // Check for duplicate CNIC
  const existingCnic = await Employee.findOne({ cnic: employeeData.cnic });
  if (existingCnic) {
    throw ApiError.conflict('Employee with this CNIC already exists');
  }

  const employee = await Employee.create({
    ...employeeData,
    createdBy: userId
  });

  return employee;
};

/**
 * Update employee
 */
const update = async (id, updateData) => {
  // Check for duplicate CNIC if being changed
  if (updateData.cnic) {
    const existingCnic = await Employee.findOne({
      cnic: updateData.cnic,
      _id: { $ne: id }
    });
    if (existingCnic) {
      throw ApiError.conflict('Employee with this CNIC already exists');
    }
  }

  const employee = await Employee.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!employee) {
    throw ApiError.notFound('Employee not found');
  }

  return employee;
};

/**
 * Delete employee
 */
const remove = async (id) => {
  const employee = await Employee.findByIdAndDelete(id);

  if (!employee) {
    throw ApiError.notFound('Employee not found');
  }

  return employee;
};

/**
 * Get employees with outstanding advances
 */
const getWithOutstandingAdvances = async () => {
  return Employee.find({
    status: 'Active',
    advanceBalance: { $gt: 0 }
  }).sort({ advanceBalance: -1 });
};

/**
 * Get employee summary
 */
const getSummary = async () => {
  const summary = await Employee.aggregate([
    {
      $group: {
        _id: '$department',
        totalEmployees: { $sum: 1 },
        activeEmployees: {
          $sum: { $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] }
        },
        totalSalary: { $sum: '$salary' },
        totalAllowances: { $sum: '$allowances' },
        totalAdvanceBalance: { $sum: '$advanceBalance' }
      }
    }
  ]);

  return summary;
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  getWithOutstandingAdvances,
  getSummary
};
