const { Employee, User, Capital } = require('../models');
const logger = require('../utils/logger');
const {
  ApiError,
  getPaginationOptions,
  getSortOptions,
  getPaginationMeta,
  logAction,
  diffFields,
  withTransaction
} = require('../utils');
const { EMPLOYEE_SEPARATED_STATUSES } = require('../constants');
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

  // Search. Escape regex metacharacters so user input can't inject a
  // catastrophic-backtracking pattern (ReDoS). Preserves contains/i behavior.
  if (query.search) {
    const escaped = String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { cnic: { $regex: escaped, $options: 'i' } },
      { phone: { $regex: escaped, $options: 'i' } }
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
const update = async (id, updateData, userId) => {
  const beforeDoc = await Employee.findById(id).lean();
  if (!beforeDoc) throw ApiError.notFound('Employee not found');

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

  // AL3: structured before/after diff over only the supplied fields.
  const diff = diffFields(beforeDoc, employee.toObject(), Object.keys(updateData));
  logAction({
    userId,
    action: 'Employee Updated',
    entityType: 'Employee',
    entityId: employee._id,
    metadata: {
      name: employee.name,
      department: employee.department,
      diff
    }
  });

  return employee;
};

/**
 * Delete employee
 */
const remove = async (id) => {
  const employee = await Employee.findById(id);

  if (!employee) {
    throw ApiError.notFound('Employee not found');
  }

  // Deactivate the linked login account if one exists. The link is stored on
  // the User side (User.employee) — Employee has no `user` field, so the old
  // `employee.user` check never matched and a deleted employee's login was
  // left ACTIVE. Query by User.employee, matching separateEmployee().
  try {
    await User.findOneAndUpdate(
      { employee: id },
      { isActive: false, employee: null }
    );
  } catch (err) {
    // Log error but continue with employee deletion
    logger.error('Failed to deactivate linked user:', err.message || err);
  }

  await Employee.findByIdAndDelete(id);
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
 * Separate an employee (resign / terminate / retire / mark inactive).
 *
 * Atomic flow:
 *   - Validate employee is currently Active.
 *   - Set status to the target (Resigned | Terminated | Retired | Inactive),
 *     stamp dateOfLeaving and leavingReason.
 *   - If `writeOffAdvance` is true AND the employee has an outstanding
 *     advanceBalance, zero the balance and post the amount as a capital loss
 *     (uncollectible advance). Captures real-world reality where a leaving
 *     employee may not return the advance.
 *   - Deactivate the linked User account, if any, so they can no longer log in.
 *
 * @param {string} id Employee id
 * @param {object} data { status, dateOfLeaving?, leavingReason?, writeOffAdvance? }
 * @param {string} userId Acting admin's id (for audit + capital ledger)
 */
const separateEmployee = async (id, data, userId) => {
  const employee = await Employee.findById(id);
  if (!employee) throw ApiError.notFound('Employee not found');

  if (employee.status !== 'Active') {
    throw ApiError.badRequest(
      `Employee is already separated (status: ${employee.status}). Reactivate first if needed.`
    );
  }

  const status = data.status;
  if (!EMPLOYEE_SEPARATED_STATUSES.includes(status)) {
    throw ApiError.badRequest(
      `Invalid separation status. Use one of: ${EMPLOYEE_SEPARATED_STATUSES.join(', ')}`
    );
  }

  const dateOfLeaving = data.dateOfLeaving ? new Date(data.dateOfLeaving) : new Date();
  const leavingReason = (data.leavingReason || '').trim();
  const shouldWriteOffAdvance = Boolean(data.writeOffAdvance);
  const outstandingAdvance = Number(employee.advanceBalance) || 0;

  await withTransaction(async (session) => {
    const sessOpt = session ? { session } : {};

    // Status transition: only flip if still Active. Conditional findOneAndUpdate
    // prevents two concurrent separation requests from both succeeding.
    const updateSet = {
      status,
      dateOfLeaving,
      leavingReason
    };
    if (shouldWriteOffAdvance && outstandingAdvance > 0) {
      updateSet.advanceBalance = 0;
    }
    const updated = await Employee.findOneAndUpdate(
      { _id: id, status: 'Active' },
      { $set: updateSet },
      { new: true, ...sessOpt }
    );
    if (!updated) {
      throw ApiError.badRequest('Employee status changed concurrently; aborting.');
    }

    // Write off the advance as a capital loss when requested.
    if (shouldWriteOffAdvance && outstandingAdvance > 0) {
      await Capital.atomicAddLoss({
        amount: outstandingAdvance,
        type: 'Other Expense',
        description: `Advance written off — ${updated.name} (${status})`,
        reference: String(updated._id),
        createdBy: userId
      }, session);
    }

    // Deactivate the linked User account if any — leaving employees should
    // not retain login access. User can be reactivated separately if needed.
    const linkedUser = await User.findOne({ employee: id }).session(session || null);
    if (linkedUser && linkedUser.isActive) {
      linkedUser.isActive = false;
      await linkedUser.save(sessOpt);
    }
  });

  // Refetch to return the latest doc with all side effects applied.
  const fresh = await Employee.findById(id);

  logAction({
    userId,
    action: 'Employee Separated',
    entityType: 'Employee',
    entityId: fresh._id,
    metadata: {
      name: fresh.name,
      previousStatus: 'Active',
      newStatus: status,
      dateOfLeaving,
      leavingReason: leavingReason || null,
      advanceWrittenOff: shouldWriteOffAdvance ? outstandingAdvance : 0,
      outstandingAdvanceAtSeparation: outstandingAdvance
    }
  });

  return fresh;
};

/**
 * Reactivate a previously-separated employee.
 * Clears dateOfLeaving and leavingReason, sets status back to Active.
 */
const reactivateEmployee = async (id, userId) => {
  const employee = await Employee.findById(id);
  if (!employee) throw ApiError.notFound('Employee not found');

  if (employee.status === 'Active') {
    throw ApiError.badRequest('Employee is already Active');
  }

  const updated = await Employee.findOneAndUpdate(
    { _id: id, status: { $ne: 'Active' } },
    {
      $set: { status: 'Active' },
      $unset: { dateOfLeaving: 1, leavingReason: 1 }
    },
    { new: true }
  );
  if (!updated) {
    throw ApiError.badRequest('Employee status changed concurrently; aborting.');
  }

  logAction({
    userId,
    action: 'Employee Reactivated',
    entityType: 'Employee',
    entityId: updated._id,
    metadata: {
      name: updated.name,
      previousStatus: employee.status
    }
  });

  return updated;
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
  resetEmployeePassword,
  separateEmployee,
  reactivateEmployee
};
