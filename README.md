# Sheep Management System - Backend API

A production-ready RESTful API for managing a sheep/goat farm, built with Node.js, Express, and MongoDB.

## Features

- **Authentication**: JWT-based authentication with refresh tokens
- **Animals Management**: Full CRUD for animals with bulk upload support
- **Pens/Sheds Management**: Manage animal housing with capacity tracking
- **Stock Management**: Track feed, medications, and other inventory
- **Employee Management**: Staff records with advance/loan tracking
- **Health & Veterinary**: Vaccination, treatment, deworming, BCS, weight tracking, hoof trimming
- **Feed Management**: Create recipes and apply to sheds with cost allocation
- **Capital Management**: Track investments and expenses
- **Dashboard**: Statistics and analytics

## Prerequisites

- Node.js >= 18.0.0
- MongoDB >= 6.0
- npm or yarn

## Installation

1. Clone the repository and navigate to backend:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Update the `.env` file with your configuration

5. Start the development server:
```bash
npm run dev
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `POST /api/auth/refresh-token` - Refresh access token
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/change-password` - Change password

### Animals
- `GET /api/animals` - Get all animals
- `GET /api/animals/:id` - Get animal by ID
- `POST /api/animals` - Create animal
- `POST /api/animals/bulk` - Bulk create animals
- `PUT /api/animals/:id` - Update animal
- `DELETE /api/animals/:id` - Delete animal

### Pens
- `GET /api/pens` - Get all pens
- `GET /api/pens/:id` - Get pen by ID
- `POST /api/pens` - Create pen
- `PUT /api/pens/:id` - Update pen
- `DELETE /api/pens/:id` - Delete pen

### Stocks
- `GET /api/stocks` - Get all stock items
- `GET /api/stocks/:id` - Get stock by ID
- `POST /api/stocks` - Create stock item
- `PUT /api/stocks/:id` - Update stock item
- `DELETE /api/stocks/:id` - Delete stock item

### Employees
- `GET /api/employees` - Get all employees
- `GET /api/employees/:id` - Get employee by ID
- `POST /api/employees` - Create employee
- `PUT /api/employees/:id` - Update employee
- `DELETE /api/employees/:id` - Delete employee

### Advances
- `GET /api/advances` - Get all advances
- `GET /api/advances/employee/:employeeId` - Get advances by employee
- `POST /api/advances` - Create advance record
- `DELETE /api/advances/:id` - Delete advance record

### Health
- `GET /api/health/vaccinations` - Get all vaccinations
- `POST /api/health/vaccinations` - Create vaccination record
- `DELETE /api/health/vaccinations/:id` - Delete vaccination

- `GET /api/health/treatments` - Get all treatments
- `POST /api/health/treatments` - Create treatment
- `PUT /api/health/treatments/:id` - Update treatment
- `DELETE /api/health/treatments/:id` - Delete treatment

- `GET /api/health/dewormings` - Get all dewormings
- `POST /api/health/dewormings` - Create deworming
- `DELETE /api/health/dewormings/:id` - Delete deworming

- `GET /api/health/weight-records` - Get weight records
- `POST /api/health/weight-records` - Create weight record

- `GET /api/health/bcs-records` - Get BCS records
- `POST /api/health/bcs-records` - Create BCS record

- `GET /api/health/hoof-records` - Get hoof records
- `POST /api/health/hoof-records` - Create hoof record
- `PUT /api/health/hoof-records/:id` - Update hoof record
- `DELETE /api/health/hoof-records/:id` - Delete hoof record

### Feed
- `GET /api/feed/recipes` - Get all recipes
- `GET /api/feed/recipes/:id` - Get recipe by ID
- `POST /api/feed/recipes` - Create recipe
- `PUT /api/feed/recipes/:id` - Update recipe
- `DELETE /api/feed/recipes/:id` - Delete recipe
- `GET /api/feed/applications` - Get all applications
- `POST /api/feed/applications` - Apply recipe

### Capital
- `GET /api/capital` - Get capital info
- `PUT /api/capital` - Update capital
- `POST /api/capital/initialize` - Initialize capital

### Dashboard
- `GET /api/dashboard/stats` - Get dashboard statistics

## Project Structure

```
backend/
├── src/
│   ├── app.js              # Express app setup
│   ├── server.js           # Server entry point
│   ├── config/             # Configuration files
│   ├── routes/             # Route definitions
│   ├── controllers/        # Request handlers
│   ├── services/           # Business logic
│   ├── models/             # Mongoose models
│   ├── middleware/         # Custom middleware
│   ├── utils/              # Utility functions
│   ├── validations/        # Joi schemas
│   └── constants/          # Constants and enums
├── tests/                  # Test files
├── .env                    # Environment variables
└── package.json
```

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## License

ISC
