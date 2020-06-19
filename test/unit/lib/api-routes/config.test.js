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

const request = require('supertest')
const app = require('../../../../src/lib/api-server').getApp()
const Config = require('../../../../src/lib/config')
const SpyGetUserConfig = jest.spyOn(Config, 'getUserConfig')
const SpyGetStoredUserConfig = jest.spyOn(Config, 'getStoredUserConfig')
const SpySetStoredUserConfig = jest.spyOn(Config, 'setStoredUserConfig')
const SpyLoadUserConfig = jest.spyOn(Config, 'loadUserConfig')
const Server = require('../../../../src/server')
const SpyServer = jest.spyOn(Server, 'restartServer')



describe('API route /config', () => {
  describe('GET /api/config/user', () => {
    it('Getting config', async () => {
      SpyGetUserConfig.mockResolvedValueOnce({})
      SpyGetStoredUserConfig.mockResolvedValueOnce({})
      const res = await request(app).get(`/api/config/user`)
      expect(res.statusCode).toEqual(200)
      expect(res.body).toHaveProperty('runtime')
      expect(res.body).toHaveProperty('stored')
    })
    it('Getting config throws an error', async () => {
      SpyGetUserConfig.mockRejectedValueOnce({})
      const res = await request(app).get(`/api/config/user`)
      expect(res.statusCode).toEqual(500)
    })
  })
  describe('PUT /api/config/user', () => {
    it('Editting config', async () => {
      const newConfig = {
        CALLBACK_ENDPOINT: 'http://localhost:5000/'
      }
      SpySetStoredUserConfig.mockResolvedValueOnce()
      SpyGetUserConfig.mockResolvedValueOnce({INBOUND_MUTUAL_TLS_ENABLED: true})
      SpyGetStoredUserConfig.mockResolvedValueOnce({INBOUND_MUTUAL_TLS_ENABLED: true})
      SpyLoadUserConfig.mockResolvedValueOnce()

      const res = await request(app).put(`/api/config/user`).send(newConfig)
      expect(res.statusCode).toEqual(200)
      expect(res.body.status).toBe('OK')
    })
    it('Editting config should relaod the server if INBOUND_MUTUAL_TLS_ENABLED was updated ', async () => {
      const newConfig = {
        CALLBACK_ENDPOINT: 'http://localhost:5000/'
      }
      SpySetStoredUserConfig.mockResolvedValueOnce()
      SpyGetUserConfig.mockResolvedValueOnce({INBOUND_MUTUAL_TLS_ENABLED: true})
      SpyGetStoredUserConfig.mockResolvedValueOnce({INBOUND_MUTUAL_TLS_ENABLED: false})
      SpyLoadUserConfig.mockResolvedValueOnce()
      SpyServer.mockResolvedValueOnce()

      const res = await request(app).put(`/api/config/user`).send(newConfig)
      expect(res.statusCode).toEqual(200)
      expect(res.body.status).toBe('OK')
    })
    it('Editting config should return 422 if CALLBACK_ENDPOINT is empty', async () => {
      const newConfig = {
        CALLBACK_ENDPOINT: ''
      }
      const res = await request(app).put(`/api/config/user`).send(newConfig)
      expect(res.statusCode).toEqual(422)
      expect(res.body.errors).toStrictEqual([{"location": "body", "msg": "Invalid value", "param": "CALLBACK_ENDPOINT", "value": ""}])
    })
    it('Editting config should throw 404 if setStoredUserConfig fails', async () => {
      const newConfig = {
        CALLBACK_ENDPOINT: 'http://localhost:5000/'
      }
      SpySetStoredUserConfig.mockRejectedValueOnce()
      const res = await request(app).put(`/api/config/user`).send(newConfig)
      expect(res.statusCode).toEqual(404)
    })
  })
})
