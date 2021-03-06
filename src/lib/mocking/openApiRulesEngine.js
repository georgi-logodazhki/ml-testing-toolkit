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
 * Vijaya Kumar Guthi <vijaya.guthi@modusbox.com> (Original Author)
 --------------
 ******/

const fs = require('fs')
var path = require('path')
const { promisify } = require('util')
const readFileAsync = promisify(fs.readFile)
const customLogger = require('../requestLogger')
const _ = require('lodash')
const rulesEngineModel = require('../rulesEngineModel')
const Config = require('../config')
const objectStore = require('../objectStore')
const utilsInternal = require('../utilsInternal')
const uuid = require('uuid')
const postmanContext = require('../test-outbound/context')

// const jsfRefFilePathPrefix = 'spec_files/jsf_ref_files/'

const removeEmpty = obj => {
  if (obj) {
    Object.keys(obj).forEach(key => {
      if (obj[key] && typeof obj[key] === 'object') removeEmpty(obj[key])
      else if (obj[key] == null) delete obj[key]
    })
  }
}

const executeScripts = async (curEvent, req) => {
  if (curEvent.params.scripts && curEvent.params.scripts.exec && curEvent.params.scripts.exec.length > 0 && curEvent.params.scripts.exec !== ['']) {
    // convert inboundEnvironment from JSON to sandbox environment format
    const sandboxEnvironment = Object.entries(objectStore.get('inboundEnvironment')).map((item) => { return { type: 'any', key: item[0], value: item[1] } })

    const contextObj = await postmanContext.generageContextObj(sandboxEnvironment)

    const postmanRequest = {
      body: JSON.stringify(req.payload),
      method: req.method,
      headers: req.headers
    }
    const postmanSandbox = await postmanContext.executeAsync(curEvent.params.scripts.exec, { context: { ...contextObj, request: postmanRequest }, id: uuid.v4() }, contextObj)

    // replace inbound environment with the sandbox environment
    const mergedInboundEnvironment = postmanSandbox.environment.reduce((envObj, item) => { envObj[item.key] = item.value; return envObj }, {})
    objectStore.set('inboundEnvironment', mergedInboundEnvironment)
    contextObj.ctx.dispose()
    contextObj.ctx = null
  }
}

const replaceEnvironmentsFromRules = async (rulesObject) => {
  const rules = JSON.parse(JSON.stringify(rulesObject || []))
  const environment = objectStore.get('inboundEnvironment')

  let reloadRules = false
  rules.forEach(rule => {
    Object.keys(rule.conditions).forEach(conditionType => {
      rule.conditions[conditionType].forEach((condition) => {
        if (condition.value && condition.value.split('.')[0] === '{$environment') {
          condition.value = getEnvironmentValue(condition.value, environment)
          reloadRules = true
        }
      })
    })
  })

  return reloadRules ? rules : undefined
}

const validateRules = async (context, req) => {
  const rules = await rulesEngineModel.getValidationRules()

  const newRules = await replaceEnvironmentsFromRules(rules)
  const rulesEngine = await rulesEngineModel.getValidationRulesEngine(newRules)

  const facts = generageFacts(context)

  const res = await rulesEngine.evaluate(facts)
  let generatedErrorCallback = {}

  if (res) {
    customLogger.logMessage('debug', 'Validation rules matched', res, true, req)
    const curEvent = res[0]
    if (curEvent.params.delay) {
      generatedErrorCallback.delay = curEvent.params.delay
    }

    await executeScripts(curEvent, req)

    if (curEvent.type === 'FIXED_ERROR_CALLBACK') {
      generatedErrorCallback.method = curEvent.params.method
      generatedErrorCallback.path = replaceVariablesFromRequest(curEvent.params.path, context, req)
      generatedErrorCallback.body = replaceVariablesFromRequest(curEvent.params.body, context, req)
      generatedErrorCallback.body = replaceVariablesFromRequest(curEvent.params.body, context, req)
      generatedErrorCallback.headers = replaceVariablesFromRequest(curEvent.params.headers, context, req)
    } else if (curEvent.type === 'MOCK_ERROR_CALLBACK') {
      if (req.customInfo.specFile) {
        generatedErrorCallback = await generateMockErrorCallback(context, req)

        _.merge(generatedErrorCallback.body, replaceVariablesFromRequest(curEvent.params.body, context, req))
        _.merge(generatedErrorCallback.headers, replaceVariablesFromRequest(curEvent.params.headers, context, req))
        removeEmpty(generatedErrorCallback.body)
      } else {
        customLogger.logMessage('error', 'No Specification file provided for validateRules function', null, true, req)
      }
    }
  }
  return generatedErrorCallback
}

const generateMockErrorCallback = async (context, req) => {
  const generatedErrorCallback = {}
  const callbackGenerator = new (require('./openApiRequestGenerator'))()
  await callbackGenerator.load(path.join(req.customInfo.specFile))
  let jsfRefs1 = []
  if (req.customInfo.jsfRefFile) {
    try {
      const rawdata = await readFileAsync(req.customInfo.jsfRefFile)
      jsfRefs1 = JSON.parse(rawdata)
    } catch (err) {}
  }
  const operationCallback = req.customInfo.callbackInfo.errorCallback.path

  if (req.customInfo.callbackInfo.errorCallback.pathPattern) {
    generatedErrorCallback.path = replaceVariablesFromRequest(req.customInfo.callbackInfo.errorCallback.pathPattern, context, req)
  } else {
    generatedErrorCallback.path = operationCallback
  }
  generatedErrorCallback.callbackInfo = replaceVariablesFromRequest(req.customInfo.callbackInfo, context, req)
  generatedErrorCallback.method = req.customInfo.callbackInfo.errorCallback.method
  generatedErrorCallback.body = await callbackGenerator.generateRequestBody(operationCallback, generatedErrorCallback.method, jsfRefs1)
  generatedErrorCallback.headers = await callbackGenerator.generateRequestHeaders(operationCallback, generatedErrorCallback.method, jsfRefs1)

  // Override the values in generated callback with the values from callback map file
  if (req.customInfo.callbackInfo.errorCallback.bodyOverride) {
    _.merge(generatedErrorCallback.body, replaceVariablesFromRequest(req.customInfo.callbackInfo.errorCallback.bodyOverride, context, req))
    removeEmpty(generatedErrorCallback.body)
  }
  if (req.customInfo.callbackInfo.errorCallback.headerOverride) {
    _.merge(generatedErrorCallback.headers, replaceVariablesFromRequest(req.customInfo.callbackInfo.errorCallback.headerOverride, context, req))
  }
  return generatedErrorCallback
}

const generageFacts = (context) => {
  return {
    operationPath: context.operation.path,
    path: context.request.path,
    method: context.request.method,
    body: context.request.body || {},
    pathParams: context.request.params || {},
    headers: context.request.headers || {},
    queryParams: context.request.query ? JSON.parse(JSON.stringify(context.request.query)) : {}
  }
}

const callbackRules = async (context, req) => {
  const rules = await rulesEngineModel.getCallbackRules()

  const newRules = await replaceEnvironmentsFromRules(rules)
  const rulesEngine = await rulesEngineModel.getCallbackRulesEngine(newRules)

  const facts = generageFacts(context)

  const res = await rulesEngine.evaluate(facts)
  const generatedCallback = {}
  if (res) {
    customLogger.logMessage('debug', 'Callback rules are matched', res, true, req)
    const curEvent = res[0]

    if (curEvent.params.delay) {
      generatedCallback.delay = curEvent.params.delay
    }

    await executeScripts(curEvent, req)

    if (curEvent.type === 'FIXED_CALLBACK') {
      // generatedCallback.method = curEvent.params.method
      // generatedCallback.path = replaceVariablesFromRequest(curEvent.params.path, context, req)
      const operationCallback = req.customInfo.callbackInfo.successCallback.path

      // Check if pathPattern from callback_map file exists and determine the callback path
      if (req.customInfo.callbackInfo.successCallback.pathPattern) {
        generatedCallback.path = replaceVariablesFromRequest(req.customInfo.callbackInfo.successCallback.pathPattern, context, req)
      } else {
        generatedCallback.path = operationCallback
      }
      generatedCallback.callbackInfo = replaceVariablesFromRequest(req.customInfo.callbackInfo, context, req)
      generatedCallback.method = req.customInfo.callbackInfo.successCallback.method
      generatedCallback.body = replaceVariablesFromRequest(curEvent.params.body, context, req)
      generatedCallback.headers = replaceVariablesFromRequest(curEvent.params.headers, context, req)
    } else if (curEvent.type === 'MOCK_CALLBACK') {
      if (req.customInfo.specFile) {
        const callbackGenerator = new (require('./openApiRequestGenerator'))()
        await callbackGenerator.load(path.join(req.customInfo.specFile))
        let jsfRefs1 = []
        if (req.customInfo.jsfRefFile) {
          try {
            const rawdata = await readFileAsync(req.customInfo.jsfRefFile)
            jsfRefs1 = JSON.parse(rawdata)
          } catch (err) {}
        }
        const operationCallback = req.customInfo.callbackInfo.successCallback.path

        // Check if pathPattern from callback_map file exists and determine the callback path
        if (req.customInfo.callbackInfo.successCallback.pathPattern) {
          generatedCallback.path = replaceVariablesFromRequest(req.customInfo.callbackInfo.successCallback.pathPattern, context, req)
        } else {
          generatedCallback.path = operationCallback
        }
        generatedCallback.callbackInfo = replaceVariablesFromRequest(req.customInfo.callbackInfo, context, req)
        generatedCallback.method = req.customInfo.callbackInfo.successCallback.method
        generatedCallback.body = await callbackGenerator.generateRequestBody(operationCallback, generatedCallback.method, jsfRefs1)
        generatedCallback.headers = await callbackGenerator.generateRequestHeaders(operationCallback, generatedCallback.method, jsfRefs1)

        // Override the values in generated callback with the values from callback map file
        if (req.customInfo.callbackInfo.successCallback.bodyOverride) {
          _.merge(generatedCallback.body, replaceVariablesFromRequest(req.customInfo.callbackInfo.successCallback.bodyOverride, context, req))
          removeEmpty(generatedCallback.body)
        }
        if (req.customInfo.callbackInfo.successCallback.headerOverride) {
          _.merge(generatedCallback.headers, replaceVariablesFromRequest(req.customInfo.callbackInfo.successCallback.headerOverride, context, req))
        }

        // Override the values in generated callback with the values from event params
        _.merge(generatedCallback.body, replaceVariablesFromRequest(curEvent.params.body, context, req))
        removeEmpty(generatedCallback.body)
        _.merge(generatedCallback.headers, replaceVariablesFromRequest(curEvent.params.headers, context, req))
      } else {
        customLogger.logMessage('error', 'No Specification file provided for validateRules function', null, true, req)
      }
    }
  } else {
    customLogger.logMessage('error', 'No callback rules are matched', res, true, req)
  }

  return generatedCallback
}

const responseRules = async (context, req) => {
  const rules = await rulesEngineModel.getResponseRules()

  const newRules = await replaceEnvironmentsFromRules(rules)
  const rulesEngine = await rulesEngineModel.getResponseRulesEngine(newRules)

  const facts = generageFacts(context)

  const res = await rulesEngine.evaluate(facts)
  const generatedResponse = {}

  if (res) {
    customLogger.logMessage('debug', 'Response rules are matched', res, true, req)
    const curEvent = res[0]
    if (curEvent.params.delay) {
      generatedResponse.delay = curEvent.params.delay
    }

    await executeScripts(curEvent, req)

    if (curEvent.type === 'FIXED_RESPONSE') {
      generatedResponse.body = replaceVariablesFromRequest(curEvent.params.body, context, req)
      generatedResponse.status = +curEvent.params.statusCode
      // generatedResponse.headers = replaceVariablesFromRequest(curEvent.params.headers, context, req)
    } else if (curEvent.type === 'MOCK_RESPONSE') {
      if (req.customInfo.specFile) {
        const responseGenerator = new (require('./openApiRequestGenerator'))()
        await responseGenerator.load(path.join(req.customInfo.specFile))
        let jsfRefs1 = []
        if (req.customInfo.jsfRefFile) {
          try {
            const rawdata = await readFileAsync(req.customInfo.jsfRefFile)
            jsfRefs1 = JSON.parse(rawdata)
          } catch (err) {}
        }
        const { body, status } = await responseGenerator.generateResponseBody(context.operation.path, context.request.method, jsfRefs1)
        generatedResponse.body = body
        generatedResponse.status = +status
        // generatedResponse.headers = await responseGenerator.generateRequestHeaders(operationCallback, generatedResponse.method, jsfRefs1)

        // Override the values in generated callback with the values from callback map file
        if (req.customInfo.responseInfo && req.customInfo.responseInfo.response.bodyOverride) {
          _.merge(generatedResponse.body, replaceVariablesFromRequest(req.customInfo.responseInfo.response.bodyOverride, context, req))
          removeEmpty(generatedResponse.body)
        }
        // if (req.customInfo.responseInfo.response.headerOverride) {
        //   _.merge(generatedResponse.headers, replaceVariablesFromRequest(req.customInfo.responseInfo.response.headerOverride, context, req))
        // }

        // Override the values in generated callback with the values from event params
        _.merge(generatedResponse.body, replaceVariablesFromRequest(curEvent.params.body, context, req))
        removeEmpty(generatedResponse.body)
        _.merge(generatedResponse.headers, replaceVariablesFromRequest(curEvent.params.headers, context, req))
      } else {
        customLogger.logMessage('error', 'No Specification file provided for responseRules function', null, true, req)
      }
    }
  } else {
    customLogger.logMessage('info', 'No response rules are matched', res, true, req)
  }
  return generatedResponse
}

const replaceVariablesFromRequest = (inputObject, context, req) => {
  var resultObject
  // Check whether inputObject is string or object. If it is object, then convert that to JSON string and parse it while return
  if (typeof inputObject === 'string') {
    resultObject = inputObject
  } else if (typeof inputObject === 'object') {
    resultObject = JSON.stringify(inputObject)
  } else {
    return inputObject
  }

  // Check the string for any inclusions like {$some_param}
  const environment = objectStore.get('inboundEnvironment')
  const matchedArray = resultObject.match(/{\$([^}]+)}/g)
  if (matchedArray) {
    matchedArray.forEach(element => {
      // Check for the function type of param, if its function we need to call a function in custom-functions and replace the returned value
      const splitArr = element.split('.')
      switch (splitArr[0]) {
        case '{$function':
          resultObject = resultObject.replace(element, getFunctionResult(element, context, req))
          break
        case '{$config':
          resultObject = resultObject.replace(element, getConfigValue(element, Config.getUserConfig()))
          break
        case '{$session':
          resultObject = resultObject.replace(element, getSessionValue(element, req.customInfo))
          break
        case '{$environment':
          resultObject = resultObject.replace(element, getEnvironmentValue(element, environment))
          break
        case '{$request':
        default:
          resultObject = resultObject.replace(element, getVariableValue(element, context))
      }
    })
  }

  if (typeof inputObject === 'object') {
    return JSON.parse(resultObject)
  } else {
    return resultObject
  }
}

// Get the variable from the object using lodash library
const getVariableValue = (param, fromObject) => {
  const temp = param.replace(/{\$(.*)}/, '$1')
  return _.get(fromObject, temp)
}

// Get the config value from the object using lodash library
const getConfigValue = (param, fromObject) => {
  const temp = param.replace(/{\$config.(.*)}/, '$1')
  return _.get(fromObject, temp)
}

// Get the customInfo value from the object using lodash library
const getSessionValue = (param, fromObject) => {
  const temp = param.replace(/{\$session.(.*)}/, '$1')
  return _.get(fromObject, temp)
}

// Execute the function and return the result
const getFunctionResult = (param, fromObject, req) => {
  return utilsInternal.getFunctionResult(param, fromObject, req)
}

const getEnvironmentValue = (param, fromObject) => {
  const temp = param.replace(/{\$environment.(.*)}/, '$1')
  return _.get(fromObject, temp)
}

module.exports = {
  validateRules,
  callbackRules,
  responseRules,
  generateMockErrorCallback
}
