import { describe, expect, it } from 'vitest';
import { evaluateAssertion, getJsonPathValue, parseHeadersToMap, resolveTemplateVariables } from './scenarioRunnerEngine';
import { parseAssertionsString } from './excelScenarioHelper';

const response = {
  status: 200,
  statusText: '200 OK',
  body: '{"data":{"id":10,"name":"Admin"}}',
  headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'abc' },
  responseTimeMs: 120,
  responseSizeByte: 1,
  timing: {}
} as any;

describe('automation scenario helpers', () => {
  it('resolves variables without modifying unresolved placeholders', () => {
    expect(resolveTemplateVariables('/users/{{id}}/{{missing}}', { id: 10 })).toBe('/users/10/{{missing}}');
  });

  it('reads nested JSON paths including array indexes', () => {
    expect(getJsonPathValue({ data: { users: [{ name: 'A' }] } }, '$.data.users[0].name')).toBe('A');
  });

  it('parses enabled headers and interpolates values', () => {
    expect(parseHeadersToMap('[{"key":"Authorization","value":"Bearer {{token}}","enabled":true},{"key":"Ignored","value":"x","enabled":false}]', { token: 'secret' }))
      .toEqual({ Authorization: 'Bearer secret' });
  });

  it('evaluates inclusive numeric and regex assertions', () => {
    const body = JSON.parse(response.body);
    expect(evaluateAssertion({ type: 'body_json', target: '$.data.id', operator: 'gte', expected: '10' } as any, response, body, {}).passed).toBe(true);
    expect(evaluateAssertion({ type: 'body_json', target: '$.data.name', operator: 'regex', expected: '^Adm' } as any, response, body, {}).passed).toBe(true);
  });

  it('keeps <= and >= inclusive when importing Excel assertions', () => {
    expect(parseAssertionsString('$.total >= 10; latency <= 120')).toEqual([
      { type: 'body_json', target: '$.total', operator: 'gte', expected: '10' },
      { type: 'time', operator: 'lte', expected: '120' }
    ]);
  });
});
