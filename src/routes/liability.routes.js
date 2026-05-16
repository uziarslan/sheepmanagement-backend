const express = require('express');
const router = express.Router();
const { liabilityController } = require('../controllers');
const { authenticate, authorize, validate, idempotency } = require('../middleware');
const { liabilityValidation } = require('../validations');

router.use(authenticate);
router.use(authorize('Admin'));

router.get('/summary', liabilityController.getSummary);
router.get(
  '/lender/:lenderName',
  validate(liabilityValidation.getByLender),
  liabilityController.getByLender
);
router.get(
  '/',
  validate(liabilityValidation.getLiabilities),
  liabilityController.getAll
);
router.post(
  '/',
  idempotency,
  validate(liabilityValidation.createLiability),
  liabilityController.create
);
router.delete('/:id', liabilityController.remove);

module.exports = router;
