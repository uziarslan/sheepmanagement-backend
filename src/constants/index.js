// Animal constants
const ANIMAL_TYPES = ['Sheep', 'Goat'];

const BREED_TYPES = [
  'Dumba',
  'Kajli',
  'Beetal',
  'Teddy',
  'Barbari',
  'Nachi',
  'Rakhshani'
];

const ANIMAL_SUBCATEGORIES = [
  'Fattening',
  'Production',
  'Breeding',
  'Heifer'
];

const SEX_OPTIONS = ['Male', 'Female'];

const COUNTRIES = [
  'Pakistan',
  'Afghanistan',
  'Iran',
  'Australia'
];

const ANIMAL_STATUSES = [
  'Active',
  'Quarantine',
  'Sold',
  'Dead',
  'Returned',
  'Slaughtered'
];

// Pen constants
const PEN_TYPES = [
  'Fattening',
  'Production',
  'Quarantine',
  'Heifer',
  'Dry',
  'Close-up'
];

// Stock constants
const STOCK_CATEGORIES = [
  'Feeding',
  'Medication',
  'Semen',
  'Seeds',
  'Fertilizers',
  'Pesticides'
];

const STOCK_UNITS = ['kg', 'gm', 'ltr', 'ml', 'nos'];

// Employee constants
const DEPARTMENTS = [
  'Operations',
  'Health',
  'Finance',
  'Administration'
];

const DESIGNATIONS = [
  'Farm Manager',
  'Veterinarian',
  'Farm Worker',
  'Accountant',
  'Supervisor',
  'Security'
];

const BANKS = [
  'HBL',
  'MCB',
  'UBL',
  'Allied Bank',
  'Bank Alfalah',
  'Meezan Bank',
  'Faysal Bank'
];

const EMPLOYEE_STATUSES = ['Active', 'Inactive', 'Terminated'];

// Advance constants
const ADVANCE_TYPES = ['Given', 'Returned'];

// Health constants
const TREATMENT_TYPES = ['Treatment', 'Protocol'];

const DIAGNOSIS_TYPES = [
  'Intrauterine',
  'Dystokia',
  'Wound',
  'Theleria',
  'Mastitis',
  'Pneumonia',
  'Diarrhea',
  'Bloat',
  'Foot Rot',
  'Pink Eye',
  'Parasitic Infection',
  'Respiratory Infection',
  'Fever',
  'Other'
];

const DEWORMING_TYPES = [
  'Albendazole',
  'Levamisole',
  'Thunder',
  'Ivermectin',
  'Fenbendazole'
];

const HOOF_DIAGNOSIS = [
  'Foot Rot',
  'Laminitis',
  'White Line Disease',
  'Sole Ulcer',
  'Heel Erosion',
  'Interdigital Dermatitis',
  'Digital Dermatitis',
  'Overgrown Hooves',
  'Cracked Hooves',
  'Abscess',
  'Routine Trimming',
  'Other'
];

const VACCINATION_SCOPES = ['All Animals', 'Shed', 'Individual Animal'];
const DEWORMING_SCOPES = ['Shed', 'Individual Animal'];

const CURE_STATUSES = ['Cured', 'Uncured', 'In Treatment'];

// BCS values (1-5 scale)
const BCS_VALUES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

// Capital transaction types
const CAPITAL_TRANSACTION_TYPES = [
  'Initial Investment',
  'Additional Investment',
  'Animal Purchase',
  'Animal Sale',
  'Infrastructure',
  'Stock Purchase',
  'Salaries',
  'Maintenance',
  'Utilities',
  'Transportation',
  'Veterinary',
  'Other Income',
  'Other Expense'
];

// User roles
const USER_ROLES = ['Admin', 'Manager', 'Employee', 'Viewer'];

// HTTP Status codes
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500
};

module.exports = {
  ANIMAL_TYPES,
  BREED_TYPES,
  ANIMAL_SUBCATEGORIES,
  SEX_OPTIONS,
  COUNTRIES,
  ANIMAL_STATUSES,
  PEN_TYPES,
  STOCK_CATEGORIES,
  STOCK_UNITS,
  DEPARTMENTS,
  DESIGNATIONS,
  BANKS,
  EMPLOYEE_STATUSES,
  ADVANCE_TYPES,
  TREATMENT_TYPES,
  DIAGNOSIS_TYPES,
  DEWORMING_TYPES,
  HOOF_DIAGNOSIS,
  VACCINATION_SCOPES,
  DEWORMING_SCOPES,
  CURE_STATUSES,
  BCS_VALUES,
  CAPITAL_TRANSACTION_TYPES,
  USER_ROLES,
  HTTP_STATUS
};
