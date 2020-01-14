const express = require('express')

const router = new express.Router()
const axios = require('axios').default
const Config = require('../config')
const customLogger = require('../requestLogger')

// Route to send a outbound request
router.post('/request', async (req, res, next) => {
  try {
    axios({
      method: req.body.method,
      url: Config.USER_CONFIG.CALLBACK_ENDPOINT + req.body.path,
      headers: req.body.headers,
      data: req.body.body,
      timeout: 3000,
      validateStatus: function (status) {
        return status < 900 // Reject only if the status code is greater than or equal to 900
      }
    }).then((result) => {
      customLogger.logMessage('info', 'Received response ' + result.status + ' ' + result.statusText, result.data, true)
    }, (err) => {
      customLogger.logMessage('info', 'Failed to send request ' + req.body.method + ' ' + req.body.path, err, true)
    })
    res.status(200).json({ status: 'OK'})
  } catch (err) {
    next(err)
  }
})

module.exports = router