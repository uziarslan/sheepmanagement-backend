/**
 * Capital Service Tests
 * Run: npm test -- capital.test.js
 */

const mongoose = require('mongoose');
const { Capital, User } = require('../models');
const { PARTNERS } = require('../constants');
const logger = require('../utils/logger');

// Mock logger
jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
}));

describe('Capital Service', () => {
  let userId;
  let capital;

  beforeAll(async () => {
    const testUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/sheep_management_test';
    await mongoose.connect(testUri);
  });

  afterAll(async () => {
    await User.deleteMany({});
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

    // Create capital record
    capital = await Capital.create({
      user: userId,
      totalCapital: 100000,
      availableAmount: 100000,
      partner1Capital: 50000,
      partner2Capital: 30000,
      retainedEarningsCapital: 20000
    });
  });

  describe('addTransaction', () => {
    it('should add income transaction and increase available amount', async () => {
      const initialAmount = capital.availableAmount;
      await capital.addTransaction(10000, 'Animal Sale', 'Test sale', 'animal123', userId);
      capital = await Capital.findById(capital._id);

      expect(capital.availableAmount).toBe(initialAmount + 10000);
      expect(capital.history.length).toBe(1);
      expect(capital.history[0].amount).toBe(10000);
      expect(capital.history[0].type).toBe('Animal Sale');
    });

    it('should add expense transaction and decrease available amount', async () => {
      const initialAmount = capital.availableAmount;
      await capital.addTransaction(-5000, 'Stock Purchase', 'Test stock', 'stock123', userId);
      capital = await Capital.findById(capital._id);

      expect(capital.availableAmount).toBe(initialAmount - 5000);
      expect(capital.investedAmount).toBe(5000);
      expect(capital.history.length).toBe(1);
    });

    it('should warn on overdraft but not throw', async () => {
      // Try to deduct more than available
      await capital.addTransaction(-150000, 'Animal Purchase', 'Test', 'ref', userId);
      capital = await Capital.findById(capital._id);

      // Should not throw but should log warning
      expect(capital.availableAmount).toBeLessThan(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle investment subtypes correctly', async () => {
      const initialPartner1 = capital.partner1Capital;
      const initialTotal = capital.totalCapital;

      await capital.addTransaction(10000, 'Additional Investment', 'Test', null, userId, PARTNERS.PARTNER_1);
      capital = await Capital.findById(capital._id);

      expect(capital.partner1Capital).toBe(initialPartner1 + 10000);
      expect(capital.totalCapital).toBe(initialTotal + 10000);
    });
  });

  describe('addLoss', () => {
    it('should record loss without changing available amount', async () => {
      const initialAmount = capital.availableAmount;
      const initialLoss = capital.loss;

      await capital.addLoss(5000, 'Dead animal', 'animal456', userId);
      capital = await Capital.findById(capital._id);

      expect(capital.loss).toBe(initialLoss + 5000);
      expect(capital.availableAmount).toBe(initialAmount);
      expect(capital.history.length).toBe(1);
    });
  });

  describe('recordAnimalSale', () => {
    it('should record sale with profit', async () => {
      const totalCost = 50000;
      const sellingPrice = 65000;
      const sellingCost = 2000;
      const expectedProfit = sellingPrice - totalCost - sellingCost;

      const initialAmount = capital.availableAmount;
      await capital.recordAnimalSale(totalCost, sellingPrice, 'Test sale', 'animal789', userId, sellingCost);
      capital = await Capital.findById(capital._id);

      expect(capital.profit).toBe(expectedProfit);
      expect(capital.availableAmount).toBe(initialAmount + sellingPrice - totalCost - sellingCost);
      expect(capital.history.length).toBe(1);
      expect(capital.history[0].type).toBe('Animal Sale');
    });

    it('should record sale with loss', async () => {
      const totalCost = 50000;
      const sellingPrice = 40000;
      const expectedLoss = totalCost + 0 - sellingPrice;

      const initialLoss = capital.loss;
      const initialAmount = capital.availableAmount;

      await capital.recordAnimalSale(totalCost, sellingPrice, 'Test loss sale', 'animal790', userId);
      capital = await Capital.findById(capital._id);

      expect(capital.loss).toBe(initialLoss + expectedLoss);
      expect(capital.availableAmount).toBe(initialAmount + sellingPrice - totalCost);
    });

    it('should apply profit against existing loss first', async () => {
      // First create a loss
      capital.loss = 10000;
      await capital.save();

      const sellingPrice = 60000;
      const totalCost = 45000;
      const profit = sellingPrice - totalCost; // 15000

      await capital.recordAnimalSale(totalCost, sellingPrice, 'Test', 'animal791', userId);
      capital = await Capital.findById(capital._id);

      // Loss should be reduced by 10000, profit should be 5000
      expect(capital.loss).toBe(0);
      expect(capital.profit).toBe(5000);
    });
  });

  describe('setInitialCapital', () => {
    it('should set initial capital with subdivision', async () => {
      const newCapital = await Capital.create({ user: new mongoose.Types.ObjectId() });

      await newCapital.setInitialCapital(60000, 40000, 50000, userId);

      const updated = await Capital.findById(newCapital._id);
      expect(updated.totalCapital).toBe(150000);
      expect(updated.partner1Capital).toBe(60000);
      expect(updated.partner2Capital).toBe(40000);
      expect(updated.retainedEarningsCapital).toBe(50000);
      expect(updated.availableAmount).toBe(150000);
      expect(updated.history.length).toBe(3);
    });
  });

  describe('getSummary', () => {
    it('should return correct capital summary', async () => {
      // Add some transactions
      await capital.addTransaction(50000, 'Animal Sale', 'Sale 1', 'ref1', userId);
      await capital.addTransaction(-20000, 'Stock Purchase', 'Stock 1', 'ref2', userId);

      const summary = await Capital.getSummary(userId);

      expect(summary.totalCapital).toBe(capital.totalCapital);
      expect(summary.availableAmount).toBeGreaterThan(0);
      expect(summary.totalIncome).toBe(50000);
      expect(summary.totalExpenses).toBe(20000);
    });
  });

  describe('getOrCreate', () => {
    it('should return existing capital', async () => {
      const existing = await Capital.getOrCreate(userId);
      expect(existing._id.toString()).toBe(capital._id.toString());
    });

    it('should create new capital if not exists', async () => {
      const newUserId = new mongoose.Types.ObjectId();
      const newCapital = await Capital.getOrCreate(newUserId);

      expect(newCapital).toBeDefined();
      expect(newCapital.user.toString()).toBe(newUserId.toString());
      expect(newCapital.totalCapital).toBe(0);
      expect(newCapital.availableAmount).toBe(0);
    });
  });
});
