const { User, Employee } = require('../models');
const { ApiError } = require('../utils');
const { USER_ROLES } = require('../constants');

/**
 * Create a new user (Admin-only endpoint)
 * Can optionally be linked to an existing employee record.
 */
const createUser = async (userData) => {
  const {
    name,
    email,
    password,
    role = 'Employee',
    phone,
    employeeId
  } = userData;

  if (!name || !email || !password) {
    throw ApiError.badRequest('Name, email and password are required');
  }

  if (!USER_ROLES.includes(role)) {
    throw ApiError.badRequest('Invalid role specified');
  }

  // Ensure email is unique
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw ApiError.conflict('A user with this email already exists');
  }

  let employeeRef = null;

  if (employeeId) {
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      throw ApiError.notFound('Employee not found for the provided employeeId');
    }

    const existingForEmployee = await User.findOne({ employee: employeeId });
    if (existingForEmployee) {
      throw ApiError.conflict('This employee already has login credentials');
    }

    employeeRef = employee._id;
  }

  const user = await User.create({
    name,
    email,
    password,
    role,
    phone,
    employee: employeeRef
  });

  return user.toJSON();
};

/**
 * Get all users (Admin-only). Excludes password; populates employee name when linked.
 */
const getUsers = async () => {
  const users = await User.find({ isActive: { $ne: false } })
    .select('-password')
    .populate('employee', 'name designation')
    .sort({ createdAt: -1 })
    .lean();
  return users;
};

/**
 * Admin reset password for any user
 */
const resetPassword = async (userId, newPassword) => {
  if (!newPassword) {
    throw ApiError.badRequest('New password is required');
  }

  const user = await User.findById(userId).select('+password');

  if (!user) {
    throw ApiError.notFound('User not found');
  }

  user.password = newPassword;
  await user.save();

  return true;
};

module.exports = {
  createUser,
  getUsers,
  resetPassword
};

