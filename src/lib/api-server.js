/*****
 License
 --------------
 Copyright © 2017 Bill & Melinda Gates Foundation
 The Mojaloop files are made available by the Bill & Melinda Gates Foundation under the Apache License, Version 2.0 (the "License") and you may not use these files except in compliance with the License. You may obtain a copy of the License at
 http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, the Mojaloop files are distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 Contributors
 --------------
 This is the official list of the Mojaloop project contributors for this file.
 Names of the original copyright holders (individuals or organizations)
 should be listed with a '*' in the first column. People who have
 contributed from an organization can be listed under the organization
 that actually holds the copyright for their contributions (see the
 Gates Foundation organization for an example). Those individuals should have
 their names indented and be marked with a '-'. Email address can be added
 optionally within square brackets <email>.
 * Gates Foundation

 * ModusBox
 * Georgi Logodazhki <georgi.logodazhki@modusbox.com>
 * Vijaya Kumar Guthi <vijaya.guthi@modusbox.com> (Original Author)
 --------------
 ******/
const express = require('express')
const app = express()
const http = require('http').Server(app)
const socketIO = require('socket.io')(http)
const passport = require('passport')
const cookieParser = require('cookie-parser')
const util = require('util')
const cors = require('cors')
const Config = require('./config')

const initServer = () => {
  // For CORS policy
  app.use(cors({ origin: true, credentials: true }))

  // For parsing incoming JSON requests
  app.use(express.json({ limit: '50mb' }))
  app.use(express.urlencoded({ extended: true }))

  // For oauth
  app.use(cookieParser())
  require('./oauth/OAuthHelper').handleMiddleware()

  // For admin API
  app.use('/api/rules', verifyUser(), require('./api-routes/rules'))
  app.use('/api/openapi', verifyUser(), require('./api-routes/openapi'))
  app.use('/api/outbound', verifyUser(), require('./api-routes/outbound'))
  app.use('/api/config', verifyUser(), require('./api-routes/config'))
  app.use('/longpolling', verifyUser(), require('./api-routes/longpolling'))
  app.use('/api/oauth2', require('./api-routes/oauth2'))
  app.use('/api/reports', verifyUser(), require('./api-routes/reports'))
  app.use('/api/settings', verifyUser(), require('./api-routes/settings'))
  app.use('/api/samples', verifyUser(), require('./api-routes/samples'))
  app.use('/api/objectstore', verifyUser(), require('./api-routes/objectstore'))
}

const startServer = port => {
  initServer()
  http.listen(port)
  console.log('API Server started on port ' + port)
}

const getApp = () => {
  if (!Object.prototype.hasOwnProperty.call(app, '_router')) { // To check whether app is initialized or not
    initServer()
  }
  return app
}

const verifyUser = () => {
  if (Config.getSystemConfig().OAUTH.AUTH_ENABLED) {
    return (req, res, next) => {
      req.session = {}
      passport.authenticate('jwt', { session: false, failureMessage: true })(req, res, next)
      // failWithError: true returns awful html error. , failureMessage: True to store failure message in req.session.messages, or a string to use as override message for failure.
      if (res.statusCode === 401) {
        const customLogger = require('./requestLogger')
        customLogger.logMessage('error', `Unable to authenticate with passport.authenticate - ${util.inspect(req.session.messages)}`, req.session.messages, false)
      }
    }
    // return passport.authenticate('jwt', { session: false, failWithError: true })
  }
  return (req, res, next) => { next() }
}

module.exports = {
  startServer,
  socketIO,
  getApp,
  verifyUser
}
