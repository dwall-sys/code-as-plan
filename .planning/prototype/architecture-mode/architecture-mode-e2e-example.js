// @gsd-context(phase:11) End-to-end example demonstrating what architecture mode OUTPUT looks like.
// @gsd-context This is NOT the implementation of architecture mode itself -- it is an example of
// what gsd-prototyper would generate when run with --architecture flag on a Node.js project.
// @gsd-ref(ref:ARCH-01) Demonstrates skeleton with folder structure, config, and typed interfaces

// ============================================================================
// EXAMPLE: Generated skeleton for a hypothetical "task-tracker" project
// Run via: /gsd:prototype --architecture --prd .planning/PRD.md
// ============================================================================

// --- FILE: src/index.js ---
// @gsd-context Main entry point -- re-exports public API surface from all module boundaries
// @gsd-decision Single entry point barrel file because the project uses CommonJS and consumers expect require('task-tracker')
// @gsd-ref(ref:ARCH-02) Structural annotation at module boundary

const { createTask, getTask, listTasks } = require('./tasks/index.js');
const { createUser, getUser } = require('./users/index.js');
const { initDatabase } = require('./database/index.js');

// @gsd-api Module exports: createTask, getTask, listTasks, createUser, getUser, initDatabase
module.exports = {
  createTask,
  getTask,
  listTasks,
  createUser,
  getUser,
  initDatabase,
};

// --- FILE: src/tasks/index.js ---
// @gsd-context(phase:11) Tasks module boundary -- all task-related operations are routed through this barrel
// @gsd-decision Separate tasks module because task CRUD is the core domain and will have the most complex business rules
// @gsd-ref(ref:ARCH-02) Structural annotation at module boundary

const { createTask } = require('./create.js');
const { getTask, listTasks } = require('./read.js');

module.exports = { createTask, getTask, listTasks };

// --- FILE: src/tasks/types.js ---
// @gsd-context(phase:11) Task type definitions -- public API surface for the tasks boundary
// @gsd-api TaskInput: creation payload; Task: full task entity; TaskFilter: query parameters

/**
 * @typedef {Object} TaskInput
 * @property {string} title
 * @property {string} [description]
 * @property {string} assigneeId
 * @property {'low'|'medium'|'high'} priority
 */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} assigneeId
 * @property {'low'|'medium'|'high'} priority
 * @property {'open'|'in_progress'|'done'} status
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} TaskFilter
 * @property {string} [assigneeId]
 * @property {'open'|'in_progress'|'done'} [status]
 * @property {'low'|'medium'|'high'} [priority]
 * @property {number} [limit]
 * @property {number} [offset]
 */

module.exports = {};

// --- FILE: src/tasks/create.js ---
// @gsd-context(phase:11) Task creation stub -- architecture skeleton only, no business logic
// @gsd-decision Create operation in its own file to isolate write-path complexity from read-path

/**
 * @param {import('./types.js').TaskInput} input
 * @returns {Promise<import('./types.js').Task>}
 */
async function createTask(input) {
  // @gsd-todo(ref:AC-1) Implement task creation with validation, ID generation, and persistence
  throw new Error('Not implemented -- architecture skeleton only');
}

module.exports = { createTask };

// --- FILE: src/tasks/read.js ---
// @gsd-context(phase:11) Task read operations stub -- architecture skeleton only
// @gsd-decision Read operations grouped together because they share query building and filtering logic

/**
 * @param {string} id
 * @returns {Promise<import('./types.js').Task|null>}
 */
async function getTask(id) {
  // @gsd-todo(ref:AC-1) Implement single task retrieval by ID
  throw new Error('Not implemented -- architecture skeleton only');
}

/**
 * @param {import('./types.js').TaskFilter} [filter]
 * @returns {Promise<import('./types.js').Task[]>}
 */
async function listTasks(filter) {
  // @gsd-todo(ref:AC-1) Implement filtered task listing with pagination
  throw new Error('Not implemented -- architecture skeleton only');
}

module.exports = { getTask, listTasks };

// --- FILE: src/users/index.js ---
// @gsd-context(phase:11) Users module boundary -- all user-related operations are routed through this barrel
// @gsd-decision Separate users module because user management has its own auth and validation concerns distinct from tasks
// @gsd-ref(ref:ARCH-02) Structural annotation at module boundary

const { createUser } = require('./create.js');
const { getUser } = require('./read.js');

module.exports = { createUser, getUser };

// --- FILE: src/users/types.js ---
// @gsd-context(phase:11) User type definitions -- public API surface for the users boundary
// @gsd-api UserInput: creation payload; User: full user entity (no password in output)
// @gsd-constraint No plaintext passwords in User type -- password hash is internal only

/**
 * @typedef {Object} UserInput
 * @property {string} email
 * @property {string} name
 * @property {string} password
 */

/**
 * @typedef {Object} User
 * @property {string} id
 * @property {string} email
 * @property {string} name
 * @property {number} createdAt
 */

module.exports = {};

// --- FILE: src/database/index.js ---
// @gsd-context(phase:11) Database module boundary -- abstracts storage behind a clean interface
// @gsd-decision Database as a separate module because storage backend may change (SQLite for dev, PostgreSQL for prod)
// @gsd-ref(ref:ARCH-02) Structural annotation at module boundary
// @gsd-risk Database module is a singleton -- concurrent initialization from multiple entry points could cause issues

/**
 * @param {Object} config
 * @param {string} config.connectionString
 * @returns {Promise<void>}
 */
async function initDatabase(config) {
  // @gsd-todo(ref:AC-1) Implement database initialization with connection pooling
  throw new Error('Not implemented -- architecture skeleton only');
}

module.exports = { initDatabase };

// --- FILE: config/default.js ---
// @gsd-context(phase:11) Default configuration -- environment-specific overrides loaded at runtime
// @gsd-decision Config in JS (not JSON) to allow environment variable interpolation and comments
// @gsd-pattern All config values have explicit defaults -- no undefined behavior when env vars are missing

module.exports = {
  port: process.env.PORT || 3000,
  database: {
    connectionString: process.env.DATABASE_URL || 'sqlite://./dev.db',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
