const SalaryPayment = require('../models/salaryPayment.model');
const Employee = require('../models/employee.model');
const Capital = require('../models/capital.model');
const Animal = require('../models/animal.model');

const createSalaryPayment = async (data, userId) => {
  const { employee: employeeId, month, year, paymentDate, paymentMode, advanceDeduction = 0, otherDeductions = 0, notes } = data;

  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw new Error('Employee not found');
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

  // Create salary payment record
  const salaryPayment = await SalaryPayment.create({
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
  });

  // Deduct advance if any
  if (advDed > 0) {
    await employee.deductAdvance(advDed);
  }

  // Record capital transaction as Salaries expense (negative amount)
  try {
    const capital = await Capital.getOrCreate(userId);
    const description = `Salary paid to ${employee.name} for ${month}/${year}`;
    await capital.addTransaction(-netSalary, 'Salaries', description, String(salaryPayment._id), userId);
  } catch (err) {
    // Do not fail the salary payment if capital logging fails; just log error
    // eslint-disable-next-line no-console
    console.error('Failed to record capital transaction for salary:', err.message || err);
  }

  // Distribute salary cost among all active animals
  try {
    const activeAnimalCount = await Animal.countDocuments({ status: 'Active' });
    if (activeAnimalCount > 0) {
      const costPerAnimal = netSalary / activeAnimalCount;
      await Animal.updateMany(
        { status: 'Active' },
        { $inc: { totalSalaryCost: costPerAnimal } }
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to distribute salary cost to animals:', err.message || err);
  }

  return salaryPayment;
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
  getSalaryPayments
};

