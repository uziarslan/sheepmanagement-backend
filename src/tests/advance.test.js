/**
 * Advance Service Tests
 * Run: npm test -- advance.test.js
 */

const mongoose = require('mongoose');
const { Advance, Employee, User } = require('../models');
const advanceService = require('../services/advance.service');

describe('Advance Service', () => {
  let userId;
  let employee;

  beforeAll(async () => {
    const testUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/sheep_management_test';
    await mongoose.connect(testUri);
  });

  afterAll(async () => {
    await User.deleteMany({});
    await Employee.deleteMany({});
    await Advance.deleteMany({});
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

    // Create employee
    employee = await Employee.create({
      name: 'Test Employee',
      cnic: `12345${Date.now()}`,
      salary: 30000,
      department: 'Labor',
      advanceBalance: 0,
      createdBy: userId
    });
  });

  describe('create', () => {
    it('should create advance record when type is Given', async () => {
      const advanceData = {
        employee: employee._id,
        type: 'Given',
        amount: 10000,
        description: 'Test advance',
        date: new Date()
      };

      const advance = await advanceService.create(advanceData, userId);

      expect(advance).toBeDefined();
      expect(advance.type).toBe('Given');
      expect(advance.amount).toBe(10000);
      expect(advance.employee.toString()).toBe(employee._id.toString());

      // Check employee balance was updated
      const updatedEmployee = await Employee.findById(employee._id);
      expect(updatedEmployee.advanceBalance).toBe(10000);
    });

    it('should create advance record when type is Returned', async () => {
      // First give an advance
      employee.advanceBalance = 15000;
      await employee.save();

      const advanceData = {
        employee: employee._id,
        type: 'Returned',
        amount: 5000,
        description: 'Return advance',
        date: new Date()
      };

      const advance = await advanceService.create(advanceData, userId);

      expect(advance.type).toBe('Returned');
      expect(advance.amount).toBe(5000);

      // Check employee balance was deducted
      const updatedEmployee = await Employee.findById(employee._id);
      expect(updatedEmployee.advanceBalance).toBe(10000);
    });

    it('should prevent return exceeding balance', async () => {
      employee.advanceBalance = 5000;
      await employee.save();

      const advanceData = {
        employee: employee._id,
        type: 'Returned',
        amount: 10000,
        description: 'Return advance'
      };

      await expect(advanceService.create(advanceData, userId)).rejects.toThrow('exceeds');
    });

    it('should set balanceAfter correctly', async () => {
      const advanceData = {
        employee: employee._id,
        type: 'Given',
        amount: 8000,
        description: 'Test'
      };

      const advance = await advanceService.create(advanceData, userId);

      expect(advance.balanceAfter).toBe(8000);
    });

    it('should throw error for non-existent employee', async () => {
      const fakeEmployeeId = new mongoose.Types.ObjectId();

      const advanceData = {
        employee: fakeEmployeeId,
        type: 'Given',
        amount: 5000
      };

      await expect(advanceService.create(advanceData, userId)).rejects.toThrow('not found');
    });
  });

  describe('remove', () => {
    it('should delete advance and reverse employee balance', async () => {
      // Create advance
      const advanceData = {
        employee: employee._id,
        type: 'Given',
        amount: 12000,
        description: 'Test advance'
      };

      const advance = await advanceService.create(advanceData, userId);

      // Employee should have balance
      let updatedEmployee = await Employee.findById(employee._id);
      expect(updatedEmployee.advanceBalance).toBe(12000);

      // Remove advance
      await advanceService.remove(advance._id);

      // Employee balance should be reversed
      updatedEmployee = await Employee.findById(employee._id);
      expect(updatedEmployee.advanceBalance).toBe(0);

      // Advance should be deleted
      const deletedAdvance = await Advance.findById(advance._id);
      expect(deletedAdvance).toBeNull();
    });

    it('should reverse balance for Returned advance', async () => {
      // Give initial advance
      employee.advanceBalance = 20000;
      await employee.save();

      // Create return advance
      const advanceData = {
        employee: employee._id,
        type: 'Returned',
        amount: 5000,
        description: 'Return advance'
      };

      const advance = await advanceService.create(advanceData, userId);

      // Employee balance should be 15000
      let updatedEmployee = await Employee.findById(employee._id);
      expect(updatedEmployee.advanceBalance).toBe(15000);

      // Remove return advance
      await advanceService.remove(advance._id);

      // Balance should go back to 20000
      updatedEmployee = await Employee.findById(employee._id);
      expect(updatedEmployee.advanceBalance).toBe(20000);
    });

    it('should throw error for non-existent advance', async () => {
      const fakeAdvanceId = new mongoose.Types.ObjectId();

      await expect(advanceService.remove(fakeAdvanceId)).rejects.toThrow('not found');
    });
  });

  describe('getByEmployee', () => {
    beforeEach(async () => {
      // Create multiple advances for same employee
      await Advance.create({
        employee: employee._id,
        type: 'Given',
        amount: 5000,
        createdBy: userId
      });

      await Advance.create({
        employee: employee._id,
        type: 'Given',
        amount: 3000,
        createdBy: userId
      });

      // Create advance for different employee
      const otherEmployee = await Employee.create({
        name: 'Other Employee',
        cnic: `67890${Date.now()}`,
        salary: 25000,
        createdBy: userId
      });

      await Advance.create({
        employee: otherEmployee._id,
        type: 'Given',
        amount: 2000,
        createdBy: userId
      });
    });

    it('should return only advances for specific employee', async () => {
      const advances = await advanceService.getByEmployee(employee._id);

      expect(advances.length).toBe(2);
      expect(advances.every(a => a.employee.toString() === employee._id.toString())).toBe(true);
    });

    it('should sort advances by date descending', async () => {
      const advances = await advanceService.getByEmployee(employee._id);

      for (let i = 0; i < advances.length - 1; i++) {
        expect(advances[i].date.getTime()).toBeGreaterThanOrEqual(advances[i + 1].date.getTime());
      }
    });
  });

  describe('getSummary', () => {
    beforeEach(async () => {
      // Create various advances
      await Advance.create({
        employee: employee._id,
        type: 'Given',
        amount: 5000,
        createdBy: userId
      });

      await Advance.create({
        employee: employee._id,
        type: 'Returned',
        amount: 2000,
        createdBy: userId
      });

      await Advance.create({
        employee: employee._id,
        type: 'Given',
        amount: 3000,
        createdBy: userId
      });

      // Update employee balance
      employee.advanceBalance = 6000;
      await employee.save();
    });

    it('should return summary with correct totals', async () => {
      const summary = await advanceService.getSummary();

      expect(summary.transactions).toBeDefined();
      const givenTx = summary.transactions.find(t => t._id === 'Given');
      const returnedTx = summary.transactions.find(t => t._id === 'Returned');

      expect(givenTx.total).toBe(8000);
      expect(givenTx.count).toBe(2);
      expect(returnedTx.total).toBe(2000);
      expect(returnedTx.count).toBe(1);
    });

    it('should return outstanding balance', async () => {
      const summary = await advanceService.getSummary();

      expect(summary.outstanding).toBeDefined();
      expect(summary.outstanding.totalAdvanceBalance).toBeGreaterThan(0);
    });
  });

  describe('getAll', () => {
    beforeEach(async () => {
      // Create advances
      await Advance.create({
        employee: employee._id,
        type: 'Given',
        amount: 5000,
        createdBy: userId
      });

      await Advance.create({
        employee: employee._id,
        type: 'Returned',
        amount: 2000,
        createdBy: userId
      });
    });

    it('should get all advances with pagination', async () => {
      const result = await advanceService.getAll({ page: 1, limit: 10 });

      expect(result.data).toBeDefined();
      expect(result.meta).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should filter by employee', async () => {
      const result = await advanceService.getAll({
        employee: employee._id.toString(),
        page: 1,
        limit: 10
      });

      expect(result.data.every(a => a.employee.toString() === employee._id.toString())).toBe(true);
    });

    it('should filter by type', async () => {
      const result = await advanceService.getAll({
        type: 'Given',
        page: 1,
        limit: 10
      });

      expect(result.data.every(a => a.type === 'Given')).toBe(true);
    });
  });
});
