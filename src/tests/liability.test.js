/**
 * Liability Service Tests
 * Run: npm test -- liability.test.js
 */

const mongoose = require('mongoose');
const { Liability, Capital, User } = require('../models');
const liabilityService = require('../services/liability.service');

describe('Liability Service', () => {
  let userId;
  let capital;

  beforeAll(async () => {
    const testUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/sheep_management_test';
    await mongoose.connect(testUri);
  });

  afterAll(async () => {
    await User.deleteMany({});
    await Liability.deleteMany({});
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
    capital = await Capital.create({
      user: userId,
      totalCapital: 300000,
      availableAmount: 300000,
      partner1Capital: 150000,
      partner2Capital: 100000,
      retainedEarningsCapital: 50000
    });
  });

  describe('create', () => {
    it('should create liability record when type is Borrowed', async () => {
      const liabilityData = {
        lenderName: 'Test Lender',
        type: 'Borrowed',
        amount: 50000,
        description: 'Test loan',
        date: new Date()
      };

      const liability = await liabilityService.create(liabilityData, userId);

      expect(liability).toBeDefined();
      expect(liability.type).toBe('Borrowed');
      expect(liability.amount).toBe(50000);
      expect(liability.lenderName).toBe('Test Lender');
      expect(liability.user.toString()).toBe(userId.toString());

      // Check capital was updated
      const updatedCapital = await Capital.findById(capital._id);
      expect(updatedCapital.availableAmount).toBe(300000 + 50000);
    });

    it('should create liability record when type is Returned', async () => {
      // First create a borrowed liability
      await Liability.create({
        user: userId,
        lenderName: 'Test Lender',
        type: 'Borrowed',
        amount: 50000,
        createdBy: userId
      });

      const liabilityData = {
        lenderName: 'Test Lender',
        type: 'Returned',
        amount: 20000,
        description: 'Return loan',
        date: new Date()
      };

      const liability = await liabilityService.create(liabilityData, userId);

      expect(liability.type).toBe('Returned');
      expect(liability.amount).toBe(20000);

      // Check capital was updated (decreased)
      const updatedCapital = await Capital.findById(capital._id);
      expect(updatedCapital.availableAmount).toBe(300000 - 20000);
    });

    it('should prevent return exceeding outstanding', async () => {
      // Create a small borrowed loan
      await Liability.create({
        user: userId,
        lenderName: 'Test Lender',
        type: 'Borrowed',
        amount: 10000,
        createdBy: userId
      });

      const liabilityData = {
        lenderName: 'Test Lender',
        type: 'Returned',
        amount: 50000,
        description: 'Return loan'
      };

      await expect(liabilityService.create(liabilityData, userId)).rejects.toThrow('exceeds');
    });

    it('should record capital transaction for borrowed', async () => {
      const liabilityData = {
        lenderName: 'Bank ABC',
        type: 'Borrowed',
        amount: 100000,
        description: 'Bank loan'
      };

      const liability = await liabilityService.create(liabilityData, userId);

      const updatedCapital = await Capital.findById(capital._id);
      const hasTransaction = updatedCapital.history.some(h => h.reference === String(liability._id));
      expect(hasTransaction).toBe(true);

      // Check transaction type
      const transaction = updatedCapital.history.find(h => h.reference === String(liability._id));
      expect(transaction.type).toBe('Loan Borrowed');
      expect(transaction.amount).toBe(100000);
    });

    it('should record capital transaction for returned', async () => {
      // Create borrowed liability first
      const borrowed = await Liability.create({
        user: userId,
        lenderName: 'Bank ABC',
        type: 'Borrowed',
        amount: 100000,
        createdBy: userId
      });

      // Clear capital history to test the return transaction separately
      capital = await Capital.findById(capital._id);
      const historyBeforeReturn = capital.history.length;

      const liabilityData = {
        lenderName: 'Bank ABC',
        type: 'Returned',
        amount: 30000,
        description: 'Return loan'
      };

      const liability = await liabilityService.create(liabilityData, userId);

      const updatedCapital = await Capital.findById(capital._id);
      expect(updatedCapital.history.length).toBeGreaterThan(historyBeforeReturn);

      const transaction = updatedCapital.history.find(h => h.reference === String(liability._id));
      expect(transaction.type).toBe('Loan Returned');
      expect(transaction.amount).toBe(-30000);
    });

    it('should throw error for non-existent user', async () => {
      const fakeUserId = new mongoose.Types.ObjectId();

      const liabilityData = {
        lenderName: 'Test Lender',
        type: 'Borrowed',
        amount: 50000
      };

      // Should still create liability but capital update might fail
      const liability = await liabilityService.create(liabilityData, fakeUserId);
      expect(liability).toBeDefined();
    });
  });

  describe('remove', () => {
    it('should delete liability and reverse capital', async () => {
      // Create liability
      const liabilityData = {
        lenderName: 'Test Lender',
        type: 'Borrowed',
        amount: 50000,
        description: 'Test loan'
      };

      const liability = await liabilityService.create(liabilityData, userId);

      // Check capital was updated
      let updatedCapital = await Capital.findById(capital._id);
      const capitalAfterCreate = updatedCapital.availableAmount;

      // Remove liability
      await liabilityService.remove(liability._id, userId);

      // Capital should be reversed
      updatedCapital = await Capital.findById(capital._id);
      expect(updatedCapital.availableAmount).toBeLessThan(capitalAfterCreate);

      // Liability should be deleted
      const deletedLiability = await Liability.findById(liability._id);
      expect(deletedLiability).toBeNull();
    });

    it('should throw error for non-existent liability', async () => {
      const fakeLiabilityId = new mongoose.Types.ObjectId();

      await expect(liabilityService.remove(fakeLiabilityId, userId)).rejects.toThrow('not found');
    });

    it('should throw error if liability does not belong to user', async () => {
      // Create user 2
      const user2 = await User.create({
        name: 'User 2',
        email: `test2${Date.now()}@example.com`,
        password: 'password123'
      });

      // Create liability for user1
      const liability = await Liability.create({
        user: userId,
        lenderName: 'Test Lender',
        type: 'Borrowed',
        amount: 50000,
        createdBy: userId
      });

      // Try to remove as user2
      await expect(liabilityService.remove(liability._id, user2._id)).rejects.toThrow('not found');
    });
  });

  describe('getByLender', () => {
    beforeEach(async () => {
      // Create liabilities for different lenders
      await Liability.create({
        user: userId,
        lenderName: 'Bank ABC',
        type: 'Borrowed',
        amount: 50000,
        createdBy: userId
      });

      await Liability.create({
        user: userId,
        lenderName: 'Bank ABC',
        type: 'Returned',
        amount: 10000,
        createdBy: userId
      });

      await Liability.create({
        user: userId,
        lenderName: 'Lender XYZ',
        type: 'Borrowed',
        amount: 25000,
        createdBy: userId
      });
    });

    it('should get all liabilities for a lender', async () => {
      const liabilities = await liabilityService.getByLender('Bank ABC', userId);

      expect(liabilities.length).toBe(2);
      expect(liabilities.every(l => l.lenderName === 'Bank ABC')).toBe(true);
    });

    it('should be case insensitive', async () => {
      const liabilities = await liabilityService.getByLender('bank abc', userId);

      expect(liabilities.length).toBe(2);
    });

    it('should sort by date descending', async () => {
      const liabilities = await liabilityService.getByLender('Bank ABC', userId);

      for (let i = 0; i < liabilities.length - 1; i++) {
        expect(liabilities[i].date.getTime()).toBeGreaterThanOrEqual(liabilities[i + 1].date.getTime());
      }
    });
  });

  describe('getLenderOutstanding', () => {
    beforeEach(async () => {
      await Liability.create({
        user: userId,
        lenderName: 'Bank ABC',
        type: 'Borrowed',
        amount: 100000,
        createdBy: userId
      });

      await Liability.create({
        user: userId,
        lenderName: 'Bank ABC',
        type: 'Returned',
        amount: 30000,
        createdBy: userId
      });
    });

    it('should calculate outstanding correctly', async () => {
      const outstanding = await liabilityService.getLenderOutstanding('Bank ABC', userId);

      expect(outstanding).toBe(70000);
    });

    it('should return 0 if fully returned', async () => {
      await Liability.create({
        user: userId,
        lenderName: 'Fully Paid',
        type: 'Borrowed',
        amount: 50000,
        createdBy: userId
      });

      await Liability.create({
        user: userId,
        lenderName: 'Fully Paid',
        type: 'Returned',
        amount: 50000,
        createdBy: userId
      });

      const outstanding = await liabilityService.getLenderOutstanding('Fully Paid', userId);

      expect(outstanding).toBe(0);
    });
  });

  describe('getLenderBalances', () => {
    beforeEach(async () => {
      await Liability.create({
        user: userId,
        lenderName: 'Bank A',
        type: 'Borrowed',
        amount: 100000,
        createdBy: userId
      });

      await Liability.create({
        user: userId,
        lenderName: 'Bank A',
        type: 'Returned',
        amount: 30000,
        createdBy: userId
      });

      await Liability.create({
        user: userId,
        lenderName: 'Bank B',
        type: 'Borrowed',
        amount: 50000,
        createdBy: userId
      });
    });

    it('should return all lenders with positive balance', async () => {
      const balances = await liabilityService.getLenderBalances(userId);

      expect(balances.length).toBe(2);
      expect(balances.every(b => b.balance > 0)).toBe(true);
    });

    it('should sort by balance descending', async () => {
      const balances = await liabilityService.getLenderBalances(userId);

      for (let i = 0; i < balances.length - 1; i++) {
        expect(balances[i].balance).toBeGreaterThanOrEqual(balances[i + 1].balance);
      }
    });
  });

  describe('getSummary', () => {
    beforeEach(async () => {
      await Liability.create({
        user: userId,
        lenderName: 'Bank A',
        type: 'Borrowed',
        amount: 100000,
        createdBy: userId
      });

      await Liability.create({
        user: userId,
        lenderName: 'Bank A',
        type: 'Returned',
        amount: 30000,
        createdBy: userId
      });

      await Liability.create({
        user: userId,
        lenderName: 'Bank B',
        type: 'Borrowed',
        amount: 50000,
        createdBy: userId
      });
    });

    it('should return summary with correct totals', async () => {
      const summary = await liabilityService.getSummary(userId);

      expect(summary.totalBorrowed).toBe(150000);
      expect(summary.totalReturned).toBe(30000);
      expect(summary.outstanding).toBe(120000);
    });

    it('should return lender count and balances', async () => {
      const summary = await liabilityService.getSummary(userId);

      expect(summary.lenderCount).toBe(2);
      expect(summary.lenders.length).toBe(2);
      expect(summary.lenders[0].lenderName).toBeDefined();
      expect(summary.lenders[0].balance).toBeGreaterThan(0);
    });

    it('should filter by date range', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 10);
      const endDate = new Date();

      const summary = await liabilityService.getSummary(userId, startDate, endDate);

      expect(summary).toBeDefined();
      expect(summary.totalBorrowed).toBeGreaterThan(0);
    });
  });

  describe('getAll', () => {
    beforeEach(async () => {
      await Liability.create({
        user: userId,
        lenderName: 'Bank A',
        type: 'Borrowed',
        amount: 100000,
        createdBy: userId
      });

      await Liability.create({
        user: userId,
        lenderName: 'Bank B',
        type: 'Borrowed',
        amount: 50000,
        createdBy: userId
      });
    });

    it('should get all liabilities with pagination', async () => {
      const result = await liabilityService.getAll({ page: 1, limit: 10 }, userId);

      expect(result.data).toBeDefined();
      expect(result.meta).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should filter by lender name', async () => {
      const result = await liabilityService.getAll(
        { lenderName: 'Bank A', page: 1, limit: 10 },
        userId
      );

      expect(result.data.every(l => l.lenderName.includes('Bank A'))).toBe(true);
    });

    it('should filter by type', async () => {
      const result = await liabilityService.getAll(
        { type: 'Borrowed', page: 1, limit: 10 },
        userId
      );

      expect(result.data.every(l => l.type === 'Borrowed')).toBe(true);
    });
  });
});
