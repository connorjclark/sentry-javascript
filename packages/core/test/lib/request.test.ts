import { Event, SentryRequest } from '@sentry/types';

import { initAPIDetails } from '../../src/api';
import { eventToSentryRequest, sessionToSentryRequest } from '../../src/request';

const ingestDsn = 'https://dogsarebadatkeepingsecrets@squirrelchasers.ingest.sentry.io/12312012';
const storeUrl =
  'https://squirrelchasers.ingest.sentry.io/api/12312012/store/?sentry_key=dogsarebadatkeepingsecrets&sentry_version=7';
const envelopeUrl =
  'https://squirrelchasers.ingest.sentry.io/api/12312012/envelope/?sentry_key=dogsarebadatkeepingsecrets&sentry_version=7';
const tunnel = 'https://hello.com/world';

const api = initAPIDetails(ingestDsn, {
  sdk: {
    integrations: ['AWSLambda'],
    name: 'sentry.javascript.browser',
    version: `12.31.12`,
    packages: [{ name: 'npm:@sentry/browser', version: `12.31.12` }],
  },
});

function parseEnvelopeRequest(request: SentryRequest): any {
  const [envelopeHeaderString, itemHeaderString, eventString] = request.body.split('\n');

  return {
    envelopeHeader: JSON.parse(envelopeHeaderString),
    itemHeader: JSON.parse(itemHeaderString),
    event: JSON.parse(eventString),
  };
}

describe('eventToSentryRequest', () => {
  let event: Event;

  beforeEach(() => {
    event = {
      contexts: { trace: { trace_id: '1231201211212012', span_id: '12261980', op: 'pageload' } },
      environment: 'dogpark',
      event_id: '0908201304152013',
      release: 'off.leash.park',
      spans: [],
      transaction: '/dogs/are/great/',
      type: 'transaction',
      user: { id: '1121', username: 'CharlieDog', ip_address: '11.21.20.12' },
      sdkProcessingMetadata: {},
    };
  });

  it('adds transaction sampling information to item header', () => {
    event.sdkProcessingMetadata = { transactionSampling: { method: 'client_rate', rate: 0.1121 } };

    const result = eventToSentryRequest(event, api);
    const envelope = parseEnvelopeRequest(result);

    expect(envelope.itemHeader).toEqual(
      expect.objectContaining({
        sample_rates: [{ id: 'client_rate', rate: 0.1121 }],
      }),
    );
  });

  it('adds sdk info to envelope header', () => {
    const result = eventToSentryRequest(event, api);
    const envelope = parseEnvelopeRequest(result);

    expect(envelope.envelopeHeader).toEqual(
      expect.objectContaining({ sdk: { name: 'sentry.javascript.browser', version: '12.31.12' } }),
    );
  });

  it('adds sdk info to event body', () => {
    const result = eventToSentryRequest(event, api);
    const envelope = parseEnvelopeRequest(result);

    expect(envelope.event).toEqual(
      expect.objectContaining({
        sdk: {
          integrations: ['AWSLambda'],
          name: 'sentry.javascript.browser',
          version: `12.31.12`,
          packages: [{ name: 'npm:@sentry/browser', version: `12.31.12` }],
        },
      }),
    );
  });

  it('merges existing sdk info if one is present on the event body', () => {
    event.sdk = {
      integrations: ['Clojure'],
      name: 'foo',
      packages: [{ name: 'npm:@sentry/clj', version: `12.31.12` }],
      version: '1337',
    };

    const result = eventToSentryRequest(event, api);
    const envelope = parseEnvelopeRequest(result);

    expect(envelope.event).toEqual(
      expect.objectContaining({
        sdk: {
          integrations: ['Clojure', 'AWSLambda'],
          name: 'foo',
          packages: [
            { name: 'npm:@sentry/clj', version: `12.31.12` },
            { name: 'npm:@sentry/browser', version: `12.31.12` },
          ],
          version: '1337',
        },
      }),
    );
  });

  it('uses tunnel as the url if it is configured', () => {
    const tunnelRequest = eventToSentryRequest(event, initAPIDetails(ingestDsn, {}, tunnel));
    expect(tunnelRequest.url).toEqual(tunnel);

    const defaultRequest = eventToSentryRequest(event, initAPIDetails(ingestDsn, {}));
    expect(defaultRequest.url).toEqual(envelopeUrl);
  });

  it('adds dsn to envelope header if tunnel is configured', () => {
    const result = eventToSentryRequest(event, initAPIDetails(ingestDsn, {}, tunnel));
    const envelope = parseEnvelopeRequest(result);

    expect(envelope.envelopeHeader).toEqual(
      expect.objectContaining({
        dsn: ingestDsn,
      }),
    );
  });

  it('adds default "event" item type to item header if tunnel is configured', () => {
    delete event.type;

    const result = eventToSentryRequest(event, initAPIDetails(ingestDsn, {}, tunnel));
    const envelope = parseEnvelopeRequest(result);

    expect(envelope.itemHeader).toEqual(
      expect.objectContaining({
        type: 'event',
      }),
    );
  });

  it('removes processing metadata before serializing event', () => {
    event.sdkProcessingMetadata = { dogs: 'are great!' };

    const result = eventToSentryRequest(event, api);
    const envelope = parseEnvelopeRequest(result);

    expect(envelope.event.processingMetadata).toBeUndefined();
  });

  it("doesn't depend on optional event fields for success ", () => {
    // all event fields are optional
    const emptyEvent = {};

    const result = eventToSentryRequest(emptyEvent, api);
    expect(result).toEqual({
      // The body isn't empty because SDK info gets added in `eventToSentryRequest`. (The specifics of that SDK info are
      // tested elsewhere.)
      body: expect.any(String),
      type: 'event',
      url: storeUrl,
    });
  });
});

describe('sessionToSentryRequest', () => {
  it('test envelope creation for aggregateSessions', () => {
    const aggregatedSession = {
      attrs: { release: '1.0.x', environment: 'prod' },
      aggregates: [{ started: '2021-04-08T12:18:00.000Z', exited: 2 }],
    };
    const result = sessionToSentryRequest(aggregatedSession, api);

    const [envelopeHeaderString, itemHeaderString, sessionString] = result.body.split('\n');

    expect(JSON.parse(envelopeHeaderString)).toEqual(
      expect.objectContaining({
        sdk: { name: 'sentry.javascript.browser', version: '12.31.12' },
      }),
    );
    expect(JSON.parse(itemHeaderString)).toEqual(
      expect.objectContaining({
        type: 'sessions',
      }),
    );
    expect(JSON.parse(sessionString)).toEqual(
      expect.objectContaining({
        attrs: { release: '1.0.x', environment: 'prod' },
        aggregates: [{ started: '2021-04-08T12:18:00.000Z', exited: 2 }],
      }),
    );
  });

  it('uses tunnel as the url if it is configured', () => {
    const tunnelRequest = sessionToSentryRequest({ aggregates: [] }, initAPIDetails(ingestDsn, {}, tunnel));
    expect(tunnelRequest.url).toEqual(tunnel);

    const defaultRequest = sessionToSentryRequest({ aggregates: [] }, initAPIDetails(ingestDsn, {}));
    expect(defaultRequest.url).toEqual(envelopeUrl);
  });

  it('adds dsn to envelope header if tunnel is configured', () => {
    const result = sessionToSentryRequest({ aggregates: [] }, initAPIDetails(ingestDsn, {}, tunnel));
    const envelope = parseEnvelopeRequest(result);

    expect(envelope.envelopeHeader).toEqual(
      expect.objectContaining({
        dsn: ingestDsn,
      }),
    );
  });
});
