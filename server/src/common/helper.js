/**
 * This file defines helper methods
 */
const querystring = require('querystring')
const _ = require('lodash')
const config = require('config')
const neo4j = require('neo4j-driver').v1
const constants = require('../../app-constants')
const errors = require('./errors')

const driver = neo4j.driver(config.GRAPH_DB_URI, neo4j.auth.basic(config.GRAPH_DB_USER, config.GRAPH_DB_PASSWORD))

/**
 * Wrap async function to standard express function
 * @param {Function} fn the async function
 * @returns {Function} the wrapped function
 */
function wrapExpress (fn) {
  return function (req, res, next) {
    fn(req, res, next).catch(next)
  }
}

/**
 * Wrap all functions from object
 * @param obj the object (controller exports)
 * @returns {Object|Array} the wrapped object
 */
function autoWrapExpress (obj) {
  if (_.isArray(obj)) {
    return obj.map(autoWrapExpress)
  }
  if (_.isFunction(obj)) {
    if (obj.constructor.name === 'AsyncFunction') {
      return wrapExpress(obj)
    }
    return obj
  }
  _.each(obj, (value, key) => {
    obj[key] = autoWrapExpress(value)
  })
  return obj
}

/**
 * Create DB session.
 * @returns {Object} new db session
 */
function createDBSession () {
  return driver.session()
}

/**
 * Ensure entity exists. Throw error if not exist.
 * @param {Object} session the db session
 * @param {String} model the model name
 * @param {String} id the entity id
 * @returns {Object} the found entity
 */
async function ensureExists (session, model, id) {
  const res = await session.run(`MATCH (e:${model} {id: {id}}) RETURN e`, { id })
  if (!res || res.records.length === 0 || !res.records[0] || !res.records[0].get(0)) {
    throw new errors.NotFoundError(`Not found ${model} of id ${id}`)
  }
  return res.records[0].get(0).properties
}

/**
 * Ensure user is member of group.
 * @param {Object} session the db session
 * @param {String} groupId the group id
 * @param {String} userId the user id
 */
async function ensureGroupMember (session, groupId, userId) {
  const memberCheckRes = await session.run('MATCH (g:Group {id: {groupId}})-[r:GroupContains {type: {membershipType}}]->(u:User {id: {userId}}) RETURN r',
    { groupId, membershipType: constants.MembershipTypes.User, userId })
  if (memberCheckRes.records.length === 0) {
    throw new errors.ForbiddenError(`User is not member of the group`)
  }
}

/**
 * Get child groups.
 * @param {Object} session the db session
 * @param {String} groupId the group id
 * @returns {Array} the child groups
 */
async function getChildGroups (session, groupId) {
  const res = await session.run('MATCH (g:Group {id: {groupId}})-[r:GroupContains]->(c:Group) RETURN c ORDER BY c.name',
    { groupId })
  return _.map(res.records, (record) => record.get(0).properties)
}

/**
 * Get parent groups.
 * @param {Object} session the db session
 * @param {String} groupId the group id
 * @returns {Array} the parent groups
 */
async function getParentGroups (session, groupId) {
  const res = await session.run('MATCH (g:Group)-[r:GroupContains]->(c:Group {id: {groupId}}) RETURN g ORDER BY g.name',
    { groupId })
  return _.map(res.records, (record) => record.get(0).properties)
}

/**
 * Get link for a given page.
 * @param {Object} req the HTTP request
 * @param {Number} page the page number
 * @returns {String} link for the page
 */
function getPageLink (req, page) {
  const q = _.assignIn({}, req.query, { page })
  return `${req.protocol}://${req.get('Host')}${req.baseUrl}${req.path}?${querystring.stringify(q)}`
}

/**
 * Set HTTP response headers from result.
 * @param {Object} req the HTTP request
 * @param {Object} res the HTTP response
 * @param {Object} result the operation result
 */
function setResHeaders (req, res, result) {
  const totalPages = Math.ceil(result.total / result.perPage)
  if (result.page < totalPages) {
    res.set('X-Next-Page', result.page + 1)
  }
  res.set('X-Page', result.page)
  res.set('X-Per-Page', result.perPage)
  res.set('X-Total', result.total)
  res.set('X-Total-Pages', totalPages)
  // set Link header
  if (totalPages > 0) {
    let link = `<${getPageLink(req, 1)}>; rel="first", <${getPageLink(req, totalPages)}>; rel="last"`
    if (result.page > 1) {
      link += `, <${getPageLink(req, result.page - 1)}>; rel="prev"`
    }
    if (result.page < totalPages) {
      link += `, <${getPageLink(req, result.page + 1)}>; rel="next"`
    }
    res.set('Link', link)
  }
}

/**
 * Check if exists.
 *
 * @param {Array} source the array in which to search for the term
 * @param {Array | String} term the term to search
 */
function checkIfExists (source, term) {
  let terms

  if (!_.isArray(source)) {
    throw new Error('Source argument should be an array')
  }

  source = source.map(s => s.toLowerCase())

  if (_.isString(term)) {
    terms = term.split(' ')
  } else if (_.isArray(term)) {
    terms = term.map(t => t.toLowerCase())
  } else {
    throw new Error('Term argument should be either a string or an array')
  }

  for (let i = 0; i < terms.length; i++) {
    if (source.includes(terms[i])) {
      return true
    }
  }

  return false
}

/**
 * Check if the user has admin role
 * @param {Object} authUser the user
 */
function hasAdminRole (authUser) {
  for (let i = 0; i < authUser.roles.length; i++) {
    if (authUser.roles[i].toLowerCase() === constants.UserRoles.Admin.toLowerCase()) {
      return true
    }
  }
  return false
}

module.exports = {
  wrapExpress,
  autoWrapExpress,
  createDBSession,
  ensureExists,
  ensureGroupMember,
  getChildGroups,
  getParentGroups,
  setResHeaders,
  checkIfExists,
  hasAdminRole
}
