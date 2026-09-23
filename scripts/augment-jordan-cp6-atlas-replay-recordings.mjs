/**
 * One-shot corpus fix: Atlas REPLAY keys are hashes of request payloads.
 * CP6 staging verify/order_create files were saved under legacy ids; search
 * offers need verify + order_create entries at deterministic paths.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { recordingIdFor } from '../src/providers/recordingStore.ts';
import { DEMO_PLAYBACK_STABLE_CLIENT_REFERENCE } from '../src/app/target/externalOfferExecution.ts';
import { DEMO_PLAYBACK_STABLE_STAY_CLIENT_REFERENCE } from '../src/app/target/externalStayExecution.ts';

const CORPUS = join(import.meta.dirname, '..', 'recordings/jordan-corpus-2026-09-23-cp6-staging');
const SESSION_ID = 'e1c907ef-f549-44e9-8d97-1a9f66efbe62';

const verifyTemplate = JSON.parse(
  readFileSync(join(CORPUS, 'atlas/verify/rec_125f6b702fde8c85027c572eb0851555.json'), 'utf8'),
);
const orderCreateTemplate = JSON.parse(
  readFileSync(join(CORPUS, 'atlas/order_create/rec_3580f252fa33262615ca2e28b259dbce.json'), 'utf8'),
);
const orderPayTemplate = JSON.parse(
  readFileSync(join(CORPUS, 'atlas/order_pay/rec_bdb45a8bc6d182010041305b6113dcbd.json'), 'utf8'),
);
const ORDER_REF = orderCreateTemplate.raw.orderNo;

const createOrderQuery = {
  offerId: '',
  passengers: [{ givenName: 'Jordan', familyName: 'Hale', gender: 'MALE', nationality: 'SG' }],
  contact: { name: 'Hale/Jordan', email: 'jordan.hale@pacificrim.test' },
  workflowState: { sessionId: SESSION_ID },
  clientReference: DEMO_PLAYBACK_STABLE_CLIENT_REFERENCE,
};

function writeRecording(providerId, operation, recording) {
  const dir = join(CORPUS, providerId, operation);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${recording.id}.json`);
  writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
  return path;
}

function soloAdultTotal(routing) {
  const amount = (routing.adultPrice ?? 0) + (routing.adultTax ?? 0);
  return { currency: routing.currency ?? 'USD', amount: Math.round(amount * 100) / 100 };
}

const routingsByOfferId = new Map();
for (const file of readdirSync(join(CORPUS, 'atlas/search')).filter((f) => f.endsWith('.json'))) {
  const raw = JSON.parse(readFileSync(join(CORPUS, 'atlas/search', file), 'utf8')).raw;
  for (const routing of raw.routings ?? []) {
    if (routing.routingIdentifier) routingsByOfferId.set(routing.routingIdentifier, routing);
  }
}

let verifyWritten = 0;
let orderWritten = 0;
for (const [offerId, routing] of routingsByOfferId) {
  const total = soloAdultTotal(routing);
  const verifyId = recordingIdFor('atlas', 'verify', { offerId });
  const verify = {
    ...verifyTemplate,
    id: verifyId,
    raw: {
      ...verifyTemplate.raw,
      sessionId: SESSION_ID,
      priceChange: {
        ...verifyTemplate.raw.priceChange,
        isPriceChange: false,
        newAdultPrice: routing.adultPrice,
        newAdultTax: routing.adultTax,
        originalAdultPrice: routing.adultPrice,
        originalAdultTax: routing.adultTax,
      },
      routing: {
        ...verifyTemplate.raw.routing,
        ...routing,
        routingIdentifier: offerId,
      },
    },
  };
  writeRecording('atlas', 'verify', verify);
  verifyWritten += 1;

  const orderId = recordingIdFor('atlas', 'order_create', { ...createOrderQuery, offerId });
  const order = {
    ...orderCreateTemplate,
    id: orderId,
    raw: {
      ...orderCreateTemplate.raw,
      totalPrice: total.amount,
      currency: total.currency,
    },
  };
  writeRecording('atlas', 'order_create', order);
  orderWritten += 1;
}

for (const payRequest of [
  { orderRef: ORDER_REF, clientReference: DEMO_PLAYBACK_STABLE_CLIENT_REFERENCE },
  { orderRef: ORDER_REF },
]) {
  const payId = recordingIdFor('atlas', 'order_pay', payRequest);
  writeRecording('atlas', 'order_pay', { ...orderPayTemplate, id: payId });
}

const bookTemplate = JSON.parse(
  readFileSync(join(CORPUS, 'nuitee/book/rec_b9aed078baa79b73e2a7a0b759cac87f.json'), 'utf8'),
);
const retrieveTemplate = JSON.parse(
  readFileSync(join(CORPUS, 'nuitee/retrieve/rec_27cb16638dc176369db835181c11f7c1.json'), 'utf8'),
);
const cancelTemplate = JSON.parse(
  readFileSync(join(CORPUS, 'nuitee/cancel/rec_3d3712e547b7ed0a875a468f571353dd.json'), 'utf8'),
);
const guestNames = ['Jordan Hale'];
let nuiteeBook = 0;
for (const file of readdirSync(join(CORPUS, 'nuitee/quote')).filter((f) => f.endsWith('.json'))) {
  const quoteRaw = JSON.parse(readFileSync(join(CORPUS, 'nuitee/quote', file), 'utf8')).raw;
  const prebookId = quoteRaw?.data?.prebookId;
  if (!prebookId) continue;
  const rateTotal =
    quoteRaw?.data?.roomTypes?.[0]?.rates?.[0]?.retailRate?.total?.[0]
    ?? { amount: 714.74, currency: 'USD' };
  const bookId = recordingIdFor('nuitee', 'book', {
    quoteId: prebookId,
    guestNames,
    clientReference: DEMO_PLAYBACK_STABLE_STAY_CLIENT_REFERENCE,
  });
  const book = JSON.parse(JSON.stringify(bookTemplate));
  book.id = bookId;
  book.raw.data.clientReference = DEMO_PLAYBACK_STABLE_STAY_CLIENT_REFERENCE;
  const room = book.raw.data.bookedRooms?.[0];
  if (room?.rate?.retailRate?.total) {
    room.rate.retailRate.total.amount = rateTotal.amount;
    room.rate.retailRate.total.currency = rateTotal.currency;
  }
  writeRecording('nuitee', 'book', book);
  nuiteeBook += 1;
}
const newBookingId = bookTemplate.raw.data.bookingId;
for (const stayElementId of ['-hCa0gm5w', 'DpnZRH43H']) {
  const cancelId = recordingIdFor('nuitee', 'cancel', { stayElementId });
  writeRecording('nuitee', 'cancel', {
    ...cancelTemplate,
    id: cancelId,
    raw: { ...cancelTemplate.raw, data: { ...cancelTemplate.raw.data, bookingId: stayElementId } },
  });
  const cancelRetrieveId = recordingIdFor('nuitee', 'retrieve', { bookingId: stayElementId });
  const cancelRetrieveTemplate =
    stayElementId === newBookingId
      ? retrieveTemplate
      : JSON.parse(readFileSync(join(CORPUS, 'nuitee/retrieve/rec_70b80f41ebcb3cd600ba8c9f031541f6.json'), 'utf8'));
  writeRecording('nuitee', 'retrieve', {
    ...cancelRetrieveTemplate,
    id: cancelRetrieveId,
    raw: {
      ...cancelRetrieveTemplate.raw,
      data: { ...cancelRetrieveTemplate.raw.data, bookingId: stayElementId, status: 'CANCELLED' },
    },
  });
}
const retrieveId = recordingIdFor('nuitee', 'retrieve', { bookingId: newBookingId });
const confirmedRetrieve = JSON.parse(JSON.stringify(retrieveTemplate));
confirmedRetrieve.id = retrieveId;
confirmedRetrieve.raw.data.bookingId = newBookingId;
confirmedRetrieve.raw.data.status = 'CONFIRMED';
confirmedRetrieve.raw.data.clientReference = DEMO_PLAYBACK_STABLE_STAY_CLIENT_REFERENCE;
writeRecording('nuitee', 'retrieve', confirmedRetrieve);

console.log(
  `augmented verify=${verifyWritten} order_create=${orderWritten} offers=${routingsByOfferId.size} order_pay=2 nuitee_book=${nuiteeBook}`,
);
