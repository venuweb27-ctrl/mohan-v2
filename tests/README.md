
## Test data
The production seed (src/seed.js) now seeds the real Mohan Mishra catalogue (src/catalogue.js).
Test suites rely on the older demo catalogue, which is seeded automatically when NODE_ENV=test
(e2e.js) or when SEED_DEMO_CATALOGUE=1 is set on the server used for the browser suites.
