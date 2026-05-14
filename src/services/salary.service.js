const logger = require('../utils/logger');
const { SalaryPayment, Employee, Capital, Animal } = require('../models');
const { withTransaction, atomic, ApiError, sampleActiveAnimal } = require('../utils');

const createSalaryPayment = async (data, userId) => {
  const { employee: employeeId, month, year, paymentDate, paymentMode, advanceDeduction = 0, otherDeductions = 0, notes } = data;

  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw new Error('Employee not found');
  }

  // Check if salary payment already exists for this employee/month/year
  const existingPayment = await SalaryPayment.findOne({
    employee: employeeId,
    month,
    year
  });
  if (existingPayment) {
    throw new Error(`Salary payment for ${employee.name} already exists for ${month}/${year}`);
  }

  // Compute salary components from employee master data
  const basicSalary = Number(employee.salary || 0);
  const allowances = Number(employee.allowances || 0);
  const grossSalary = basicSalary + allowances;

  if (grossSalary <= 0) {
    throw new Error('Employee salary is not configured');
  }

  const advDed = Number(advanceDeduction || 0);
  const otherDed = Number(otherDeductions || 0);

  if (advDed > employee.advanceBalance) {
    throw new Error('Advance deduction cannot exceed current advance balance');
  }

  const netSalary = grossSalary - advDed - otherDed;
  if (netSalary < 0) {
    throw new Error('Net salary cannot be negative');
  }

  // Atomic: salary record + advance deduction + capital tx + animal cost
  // distribution all commit together. SAL1 fix.
  const salaryPayment = await withTransaction(async (session) => {
    const [created] = await SalaryPayment.create(
      [{
        employee: employee._id,
        month,
        year,
        basicSalary,
        allowances,
        grossSalary,
        advanceDeduction: advDed,
        otherDeductions: otherDed,
        netSalary,
        paymentDate: paymentDate || new Date(),
        paymentMode: paymentMode || 'Cash',
        notes,
        createdBy: userId
      }],
      session ? { session } : {}
    );

    // Atomic advance deduction — conditional on balance ≥ deduction.
    if (advDed > 0) {
      await atomic.atomicDeductAdvance(employee._id, advDed, session);
    }

    // Capital expense (atomic singleton write).
    const capRes = await Capital.atomicAddTransaction({
      amount: -netSalary,
      type: 'Salaries',
      description: `Salary paid to ${employee.name} for ${month}/${year}`,
      reference: String(created._id),
      createdBy: userId
    }, session);
    if (!capRes) {
      throw ApiError.badRequest(
        'Capital not initialized. Initialize capital before recording salary payments.'
      );
    }

    // Distribute salary cost across active animals.
    const activeAnimalCount = await Animal.countDocuments({ status: 'Active' })
      .session(session || null);
    if (activeAnimalCount > 0) {
      const costPerAnimal = Math.floor((netSalary / activeAnimalCount) * 100) / 100;
      const remainder = Math.round((netSalary - (costPerAnimal * activeAnimalCount)) * 100) / 100;

      await Animal.updateMany(
        { status: 'Active' },
        { $inc: { totalSalaryCost: costPerAnimal } },
        session ? { session } : {}
      );

      if (remainder > 0) {
        // X4 (Sprint 5): random active animal absorbs the paisa remainder
        // — uniform distribution prevents bias on the oldest animal.
        const picked = await sampleActiveAnimal({}, session);
        if (picked) {
          await Animal.findByIdAndUpdate(
            picked._id,
            { $inc: { totalSalaryCost: remainder } },
            session ? { session } : {}
          );
        }
      }
    }

    return created;
  });

  return salaryPayment;
};

/**
 * Reverse a salary payment (SAL2).
 *
 * Use case: a salary was paid by mistake (wrong employee, wrong amount,
 * duplicate run). Atomically:
 *   - Refunds advance deduction back to the employee.
 *   - Reverses the 'Salaries' capital expense (returns netSalary to available).
 *   - Subtracts the per-animal share from active animals' totalSalaryCost.
 *   - Deletes the SalaryPayment record.
 *
 * Capital reversal uses the SAME activeAnimalCount snapshot as the original
 * payment when possible. For accuracy we use the CURRENT active count;
 * historical accuracy is acceptable for a corrective operation.
 */
const reverseSalaryPayment = async (id, userId) => {
  const payment = await SalaryPayment.findById(id);
  if (!payment) {
    throw new Error('Salary payment not found');
  }

  await withTransaction(async (session) => {
    // Refund advance deduction (if any).
    if (payment.advanceDeduction > 0) {
      await atomic.atomicAddAdvance(payment.employee, payment.advanceDeduction, session);
    }

    // Reverse capital expense: post a 'Salary Reversal' line that returns
    // netSalary to available cash. Salaries weren't in the investmentTypes
    // list, so reverseTransaction adjusts availableAmount only.
    await Capital.atomicReverseTransaction({
      amount: -payment.netSalary, // original signed amount
      type: 'Salaries',
      reversalType: 'Salary Reversal',
      description: `Salary reversal for ${payment.month}/${payment.year} (payment ${payment._id})`,
      reference: String(payment._id),
      createdBy: userId
    }, session);

    // Reverse per-animal salary cost distribution.
    const activeAnimalCount = await Animal.countDocuments({ status: 'Active' })
      .session(session || null);
    if (activeAnimalCount > 0 && payment.netSalary > 0) {
      const costPerAnimal = Math.floor((payment.netSalary / activeAnimalCount) * 100) / 100;
      const remainder = Math.round(
        (payment.netSalary - (costPerAnimal * activeAnimalCount)) * 100
      ) / 100;

      await Animal.updateMany(
        { status: 'Active' },
        { $inc: { totalSalaryCost: -costPerAnimal } },
        session ? { session } : {}
      );

      if (remainder > 0) {
        // X4 (Sprint 5): random active animal — symmetric with create path.
        const picked = await sampleActiveAnimal({}, session);
        if (picked) {
          await Animal.findByIdAndUpdate(
            picked._id,
            { $inc: { totalSalaryCost: -remainder } },
            session ? { session } : {}
          );
        }
      }
    }

    await SalaryPayment.findByIdAndDelete(id, session ? { session } : {});
  });

  return payment;
};

const getSalaryPayments = async (query) => {
  const {
    page = 1,
    limit = 20,
    employee,
    month,
    year,
    sort = '-paymentDate'
  } = query;

  const filter = {};
  if (employee) filter.employee = employee;
  if (month) filter.month = month;
  if (year) filter.year = year;

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    SalaryPayment.find(filter)
      .populate('employee', 'name designation salary allowances advanceBalance')
      .sort(sort)
      .skip(skip)
      .limit(limit),
    SalaryPayment.countDocuments(filter)
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    data,
    page,
    limit,
    total,
    totalPages
  };
};

module.exports = {
  createSalaryPayment,
  reverseSalaryPayment,
  getSalaryPayments
};

