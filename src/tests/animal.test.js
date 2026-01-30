/**
 * Animal API Tests
 * Run: npm test
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const { User, Animal, Pen } = require('../models');

describe('Animal API', () => {
  let token;
  let testPen;

  beforeAll(async () => {
    // Connect to test database
    const testUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/sheep_management_test';
    await mongoose.connect(testUri);
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    // Clear data
    await User.deleteMany({});
    await Animal.deleteMany({});
    await Pen.deleteMany({});

    // Create test user and get token
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
        confirmPassword: 'password123'
      });

    token = res.body.data.tokens.accessToken;

    // Create test pen
    testPen = await Pen.create({
      name: 'Test Pen',
      type: 'Fattening',
      capacity: 20
    });
  });

  describe('GET /api/animals', () => {
    it('should get all animals', async () => {
      // Create test animals
      await Animal.create([
        {
          tagId: 'SHP-001',
          animalType: 'Sheep',
          breedType: 'Dumba',
          subcategory: 'Fattening',
          sex: 'Male',
          arrivalDate: new Date(),
          purchasePrice: 50000,
          weight: 35
        },
        {
          tagId: 'SHP-002',
          animalType: 'Goat',
          breedType: 'Teddy',
          subcategory: 'Production',
          sex: 'Female',
          arrivalDate: new Date(),
          purchasePrice: 40000,
          weight: 30
        }
      ]);

      const res = await request(app)
        .get('/api/animals')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it('should filter animals by status', async () => {
      await Animal.create([
        {
          tagId: 'SHP-001',
          animalType: 'Sheep',
          breedType: 'Dumba',
          subcategory: 'Fattening',
          sex: 'Male',
          arrivalDate: new Date(),
          purchasePrice: 50000,
          weight: 35,
          status: 'Active'
        },
        {
          tagId: 'SHP-002',
          animalType: 'Sheep',
          breedType: 'Kajli',
          subcategory: 'Fattening',
          sex: 'Male',
          arrivalDate: new Date(),
          purchasePrice: 45000,
          weight: 32,
          status: 'Sold'
        }
      ]);

      const res = await request(app)
        .get('/api/animals?status=Active')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('Active');
    });
  });

  describe('POST /api/animals', () => {
    it('should create a new animal', async () => {
      const res = await request(app)
        .post('/api/animals')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tagId: 'SHP-001',
          animalType: 'Sheep',
          breedType: 'Dumba',
          subcategory: 'Fattening',
          sex: 'Male',
          arrivalDate: new Date(),
          purchasePrice: 50000,
          weight: 35,
          pen: testPen._id
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tagId).toBe('SHP-001');
    });

    it('should not create animal with duplicate tagId', async () => {
      await Animal.create({
        tagId: 'SHP-001',
        animalType: 'Sheep',
        breedType: 'Dumba',
        subcategory: 'Fattening',
        sex: 'Male',
        arrivalDate: new Date(),
        purchasePrice: 50000,
        weight: 35
      });

      const res = await request(app)
        .post('/api/animals')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tagId: 'SHP-001',
          animalType: 'Goat',
          breedType: 'Teddy',
          subcategory: 'Production',
          sex: 'Female',
          arrivalDate: new Date(),
          purchasePrice: 40000,
          weight: 30
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PUT /api/animals/:id', () => {
    it('should update an animal', async () => {
      const animal = await Animal.create({
        tagId: 'SHP-001',
        animalType: 'Sheep',
        breedType: 'Dumba',
        subcategory: 'Fattening',
        sex: 'Male',
        arrivalDate: new Date(),
        purchasePrice: 50000,
        weight: 35
      });

      const res = await request(app)
        .put(`/api/animals/${animal._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          weight: 40,
          status: 'Sold',
          soldPrice: 60000
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.weight).toBe(40);
      expect(res.body.data.status).toBe('Sold');
    });
  });

  describe('DELETE /api/animals/:id', () => {
    it('should delete an animal', async () => {
      const animal = await Animal.create({
        tagId: 'SHP-001',
        animalType: 'Sheep',
        breedType: 'Dumba',
        subcategory: 'Fattening',
        sex: 'Male',
        arrivalDate: new Date(),
        purchasePrice: 50000,
        weight: 35
      });

      const res = await request(app)
        .delete(`/api/animals/${animal._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify deletion
      const deleted = await Animal.findById(animal._id);
      expect(deleted).toBeNull();
    });
  });
});
