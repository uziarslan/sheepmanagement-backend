const { Advance, Employee } = require('../models');
const logger = require('../utils/logger');
const { ApiError, getPaginationOptions, getSortOptions, getPaginationMeta } = require('../utils');

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
 * Create advance record
 */
const create = async (advanceData, userId) => {
  // Validate employee exists
  const employee = await Employee.findById(advanceData.employee);
  if (!employee) {
    throw ApiError.notFound('Employee not found');
  }

  // Validate return amount
  if (advanceData.type === 'Returned' && advanceData.amount > employee.advanceBalance) {
    throw ApiError.badRequest(
      `Return amount exceeds current balance. Available: ${employee.advanceBalance}`
    );
  }

  const advance = await Advance.create({
    ...advanceData,
    approvedBy: userId,
    createdBy: userId
  });

  // Update employee balance in service layer (after advance is created)
  try {
    if (advanceData.type === 'Given') {
      employee.advanceBalance += advanceData.amount;
    } else {
      employee.advanceBalance -= advanceData.amount;
    }
    advance.balanceAfter = employee.advanceBalance;
    await employee.save();
    await advance.save();
  } catch (err) {
    // If balance update fails, still return the advance
    logger.error('Failed to update employee balance:', err.message || err);
  }

  // Populate for response (include dateOfJoining so tenureMonths virtual can compute)
  await advance.populate('employee', 'name cnic department advanceBalance dateOfJoining');

  return advance;
};

const remove = async (id) => {
  const advance = await Advance.findById(id);

  if (!advance) {
    throw ApiError.notFound('Advance record not found');
  }

  // Reverse employee advance balance before deleting (P1-11 / F-26)
  try {
    const employee = await Employee.findById(advance.employee);
    if (employee) {
      if (advance.type === 'Given') {
        // Advance was given earlier, so subtract it now to reverse
        employee.advanceBalance = Math.max(0, (employee.advanceBalance || 0) - advance.amount);
      } else {
        // Advance was returned earlier, so add it back to reverse
        employee.advanceBalance = (employee.advanceBalance || 0) + advance.amount;
      }
      await employee.save();
    }
  } catch (err) {
    // Log error but continue with deletion
    logger.error('Failed to reverse employee advance balance:', err.message || err);
  }

  await Advance.findByIdAndDelete(id);
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
