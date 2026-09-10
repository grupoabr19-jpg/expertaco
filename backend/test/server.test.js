const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { server, validRanking } = require('../server');

function invokeRequest(method, url) {
  return new Promise(resolve => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = {};
    req.socket = { remoteAddress: '127.0.0.1' };

    const res = new EventEmitter();
    res.writeHead = (statusCode, headers) => {
      res.statusCode = statusCode;
      res.headers = headers;
    };
    res.end = body => {
      res.body = body;
      resolve(res);
    };

    server.listeners('request')[0](req, res);
  });
}

test('valida contrato correto de ranking', () => {
  assert.equal(validRanking({ period:'Agosto/2026', regions:[{name:'Sul',salesAmount:10}], sellers:[] }), true);
});

test('rejeita contrato incompleto', () => {
  assert.equal(validRanking({ period:'x', regions:[] }), false);
});

test('endpoint de saúde responde', async () => {
  const res = await invokeRequest('GET', '/api/health');
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.status, 'ok');
});
