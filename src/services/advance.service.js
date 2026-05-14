const { Advance, Employee } = require('../models');
const logger = require('../utils/logger');
const {
  ApiError,
  getPaginationOptions,
  getSortOptions,
  getPaginationMeta,
  withTransaction,
  atomic,
  logAction
} = require('../utils');

/**
 * Get all advances with filters
 */
const getAll = async (query) => {
  const { page, limit, skip } = getPaginationOptions(query);
  const sort = getSortOptions(query.sort || '-date');

  // Build filter
  const filter = {};
  if (query.employee) filter.employee = query.employee;
  if (query.type) filter.type = query.type;
  
  // Date range
  if (query.startDate || query.endDate) {
    filter.date = {};
    if (query.startDate) filter.date.$gte = new Date(query.startDate);
    if (query.endDate) filter.date.$lte = new Date(query.endDate);
  }

  const [advances, total] = await Promise.all([
    Advance.find(filter)
      .populate('employee', 'name cnic department')
      .populate('approvedBy', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Advance.countDocuments(filter)
  ]);

  return {
    data: advances,
    meta: getPaginationMeta(total, page, limit)
  };
};

/**
 * Get advances by employee
 */
const getByEmployee = async (employeeId) => {
  const advances = await Advance.find({ employee: employeeId })
    .populate('approvedBy', 'name')
    .sort({ date: -1 });

  return advances;
};

/**
 * Create advance record.
 * Atomic: advance write + employee balance update commit together (AD1 fix).
 * Balance update uses an atomic conditional decrement for Returned advances,
 * so two parallel returns cannot both pass the balance check.
 */
const create = async (advanceData, userId) => {
  // Validate employee exists (also gives us name for error messages)
  const employee = await Employee.findById(advanceData.employee);
  if (!employee) {
    throw ApiError.notFound('Employee not found');
  }

  const advance = await withTransaction(async (session) => {
    let newBalance;
    if (advanceData.type === 'Given') {
      const updated = await atomic.atomicAddAdvance(
        advanceData.employee,
        advanceData.amount,
        session
      );
      newBalance = updated.advanceBalance;
    } else {
      // 'Returned' — conditional decrement; throws if exceeds balance.
      const updated = await atomic.atomicDeductAdvance(
        advanceData.employee,
        advanceData.amount,
        session
      );
      newBalance = updated.advanceBalance;
    }

    const [created] = await Advance.create(
      [{
        ...advanceData,
        balanceAfter: newBalance,
        approvedBy: userId,
        createdBy: userId
      }],
      session ? { session } : {}
    );

    return created;
  });

  await advance.populate('employee', 'name cnic department advanceBalance dateOfJoining');

  logAction({
    userId,
    action: advance.type === 'Given' ? 'Advance Given' : 'Advance Returned',
    entityType: 'Advance',
    entityId: advance._id,
    metadata: {
      employeeId: advance.employee?._id || advance.employee,
      employeeName: advance.employee?.name,
      amount: advance.amount,
      type: advance.type,
      balanceAfter: advance.balanceAfter
    }
  });

  return advance;
};

const remove = async (id, userId) => {
  const advance = await Advance.findById(id);

  if (!advance) {
    throw ApiError.notFound('Advance record not found');
  }

  await withTransaction(async (session) => {
    if (advance.type === 'Given') {
      // Reversing a Given advance = subtract from balance. Clamp at 0 via
      // findOneAndUpdate filter: only decrement if balance is large enough.
      // If the employee has already used the advance, the reversal is partial.
      const employee = await Employee.findById(advance.employee).session(session || null);
      if (employee) {
        const newBal = Math.max(0, (employee.advanceBalance || 0) - advance.amount);
        await Employee.findByIdAndUpdate(
          advance.employee,
          { $set: { advanceBalance: newBal } },
          session ? { session } : {}
        );
      }
    } else {
      // Reversing a Returned advance = add it back.
      await atomic.atomicAddAdvance(advance.employee, advance.amount, session);
    }

    await Advance.findByIdAndDelete(id, session ? { session } : {});
  });

  logAction({
    userId,
    action: 'Advance Deleted',
    entityType: 'Advance',
    entityId: advance._id,
    metadata: {
      employeeId: advance.employee,
      amount: advance.amount,
      type: advance.type
    }
  });

  return advance;
};

/**
 * Get advance summary
 */
const getSummary = async (startDate, endDate) => {
  const match = {};
  
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }

  const summary = await Advance.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);

  // Get total outstanding
  const totalOutstanding = await Employee.aggregate([
    { $match: { status: 'Active' } },
    {
      $group: {
        _id: null,
        totalAdvanceBalance: { $sum: '$advanceBalance' },
        employeesWithAdvance: {
          $sum: { $cond: [{ $gt: ['$advanceBalance', 0] }, 1, 0] }
        }
      }
    }
  ]);

  return {
    transactions: summary,
    outstanding: totalOutstanding[0] || { totalAdvanceBalance: 0, employeesWithAdvance: 0 }
  };
};

module.exports = {
  getAll,
  getByEmployee,
  create,
  remove,
  getSummary
};
