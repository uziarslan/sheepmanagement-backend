const { Employee, User } = require('../models');
const { ApiError, getPaginationOptions, getSortOptions, getPaginationMeta } = require('../utils');
const userService = require('./user.service');

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
 * Optionally creates login credentials when createCredentials is true.
 */
const create = async (employeeData, userId) => {
  // Check for duplicate CNIC
  const existingCnic = await Employee.findOne({ cnic: employeeData.cnic });
  if (existingCnic) {
    throw ApiError.conflict('Employee with this CNIC already exists');
  }

  const {
    createCredentials,
    loginPassword,
    ...employeeFields
  } = employeeData;

  if (createCredentials) {
    if (!employeeFields.email) {
      throw ApiError.badRequest('Email is required to create login credentials');
    }

    if (!loginPassword) {
      throw ApiError.badRequest('Password is required to create login credentials');
    }

    // Ensure email is not already used by another user
    const existingUser = await User.findOne({ email: employeeFields.email });
    if (existingUser) {
      throw ApiError.conflict('A user with this email already exists');
    }
  }

  const employee = await Employee.create({
    ...employeeFields,
    createdBy: userId
  });

  if (createCredentials) {
    await userService.createUser({
      name: employee.name,
      email: employee.email,
      password: loginPassword,
      role: 'Employee',
      phone: employee.phone,
      employeeId: employee._id
    });
  }

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

/**
 * Reset login password for an employee (Admin-only)
 */
const resetEmployeePassword = async (employeeId, newPassword) => {
  const employee = await Employee.findById(employeeId);

  if (!employee) {
    throw ApiError.notFound('Employee not found');
  }

  const user = await User.findOne({ employee: employeeId });

  if (!user) {
    throw ApiError.notFound('No login credentials found for this employee');
  }

  await userService.resetPassword(user._id, newPassword);

  return true;
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  getWithOutstandingAdvances,
  getSummary,
  resetEmployeePassword
};
