/**
 * Salary Service Tests
 * Run: npm test -- salary.test.js
 */

const mongoose = require('mongoose');
const { SalaryPayment, Employee, Animal, User, Capital } = require('../models');
const salaryService = require('../services/salary.service');

describe('Salary Service', () => {
  let userId;
  let employee;
  let animal;

  beforeAll(async () => {
    const testUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/sheep_management_test';
    await mongoose.connect(testUri);
  });

  afterAll(async () => {
    await User.deleteMany({});
    await Employee.deleteMany({});
    await Animal.deleteMany({});
    await SalaryPayment.deleteMany({});
    await Capital.deleteMany({});
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    // Create test user
    const user = await User.create({
      name: 'Test User',
      email: `test${Date.now()}@example.com`,
      password: 'password123'
    });
    userId = user._id;

    // Create capital for user
    await Capital.create({
      user: userId,
      totalCapital: 500000,
      availableAmount: 500000,
      partner1Capital: 250000,
      partner2Capital: 150000,
      retainedEarningsCapital: 100000
    });

    // Create employee
    employee = await Employee.create({
      name: 'Test Employee',
      cnic: `12345${Date.now()}`,
      salary: 30000,
      allowances: 5000,
      department: 'Labor',
      createdBy: userId
    });

    // Create animals for salary cost distribution
    animal = await Animal.create({
      tagNumber: 'ANIMAL-001',
      name: 'Test Animal 1',
      breed: 'Desi',
      animalType: 'Sheep',
      purchaseDate: new Date(),
      createdBy: userId
    });
  });

  describe('createSalaryPayment', () => {
    it('should create salary payment with correct amounts', async () => {
      const data = {
        employee: employee._id,
        month: 'January',
        year: 2024,
        advanceDeduction: 2000,
        otherDeductions: 1000,
        notes: 'Test payment'
      };

      const payment = await salaryService.createSalaryPayment(data, userId);

      expect(payment).toBeDefined();
      expect(payment.basicSalary).toBe(30000);
      expect(payment.allowances).toBe(5000);
      expect(payment.grossSalary).toBe(35000);
      expect(payment.advanceDeduction).toBe(2000);
      expect(payment.otherDeductions).toBe(1000);
      expect(payment.netSalary).toBe(32000);
    });

    it('should prevent duplicate salary for same employee/month/year', async () => {
      const data = {
        employee: employee._id,
        month: 'January',
        year: 2024
      };

      // First payment should succeed
      await salaryService.createSalaryPayment(data, userId);

      // Second payment should fail
      await expect(salaryService.createSalaryPayment(data, userId)).rejects.toThrow('already exists');
    });

    it('should prevent advance deduction exceeding balance', async () => {
      const data = {
        employee: employee._id,
        month: 'January',
        year: 2024,
        advanceDeduction: 100000
      };

      await expect(salaryService.createSalaryPayment(data, userId)).rejects.toThrow('exceeds');
    });

    it('should apply float rounding correctly', async () => {
      // Create 3 animals to test rounding distribution
      await Animal.create({
        tagNumber: 'ANIMAL-002',
        breed: 'Desi',
        animalType: 'Sheep',
        purchaseDate: new Date(),
        createdBy: userId
      });
      await Animal.create({
        tagNumber: 'ANIMAL-003',
        breed: 'Desi',
        animalType: 'Sheep',
        purchaseDate: new Date(),
        createdBy: userId
      });

      const data = {
        employee: employee._id,
        month: 'February',
        year: 2024,
        advanceDeduction: 0,
        otherDeductions: 0
      };

      const payment = await salaryService.createSalaryPayment(data, userId);

      // Check animal costs were distributed
      const animals = await Animal.find({ status: 'Active' });
      const totalCostOnAnimals = animals.reduce((sum, a) => sum + a.totalSalaryCost, 0);

      // Should match payment netSalary due to remainder handling
      expect(Math.abs(totalCostOnAnimals - payment.netSalary)).toBeLessThan(0.01);
    });

    it('should record capital transaction', async () => {
      const data = {
        employee: employee._id,
        month: 'March',
        year: 2024
      };

      const payment = await salaryService.createSalaryPayment(data, userId);

      const capital = await Capital.findOne({ user: userId });
      const hasTransaction = capital.history.some(h => h.reference === String(payment._id));
      expect(hasTransaction).toBe(true);
    });

    it('should deduct advance from employee balance', async () => {
      // Add advance to employee first
      employee.advanceBalance = 5000;
      await employee.save();

      const data = {
        employee: employee._id,
        month: 'April',
        year: 2024,
        advanceDeduction: 3000
      };

      await salaryService.createSalaryPayment(data, userId);

      const updatedEmployee = await Employee.findById(employee._id);
      expect(updatedEmployee.advanceBalance).toBe(2000);
    });
  });

  describe('getSalaryPayments', () => {
    beforeEach(async () => {
      // Create multiple salary payments
      await SalaryPayment.create({
        employee: employee._id,
        month: 'January',
        year: 2024,
        basicSalary: 30000,
        grossSalary: 35000,
        netSalary: 35000,
        createdBy: userId
      });

      await SalaryPayment.create({
        employee: employee._id,
        month: 'February',
        year: 2024,
        basicSalary: 30000,
        grossSalary: 35000,
        netSalary: 35000,
        createdBy: userId
      });
    });

    it('should get all salary payments with pagination', async () => {
      const result = await salaryService.getSalaryPayments({
        page: 1,
        limit: 10
      });

      expect(result.data.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
      expect(result.page).toBe(1);
    });

    it('should filter by employee', async () => {
      const result = await salaryService.getSalaryPayments({
        employee: employee._id.toString(),
        page: 1,
        limit: 10
      });

      expect(result.data.every(p => p.employee.toString() === employee._id.toString())).toBe(true);
    });

    it('should filter by month and year', async () => {
      const result = await salaryService.getSalaryPayments({
        month: 'January',
        year: 2024,
        page: 1,
        limit: 10
      });

      expect(result.data.every(p => p.month === 'January' && p.year === 2024)).toBe(true);
    });
  });
});
