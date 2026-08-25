// Copy fixtures/ to a temp dir excluding fixtures/recordings/atlas/flight_state_query,
// so a REPLAY run with FIXTURES_DIR pointed here must resolve flight_state_query
// recordings from recordings/ (the fresh RECORD artifacts) — proving RECORD->REPLAY
// equivalence through the same normalization/engine path.
import { cpSync, rmSync, existsSync } from 'node:fs';

const target = 'output/tmp-fixtures-replay-of-record';
if (existsSync(target)) rmSync(target, { recursive: true, force: true });
cpSync('fixtures', target, {
  recursive: true,
  filter: (src) => !src.replace(/\\/g, '/').includes('fixtures/recordings/atlas/flight_state_query'),
});
console.log('copied fixtures to', target);
console.log('excluded dir present?', existsSync(`${target}/recordings/atlas/flight_state_query`));
console.log('other atlas recordings present?', existsSync(`${target}/recordings/atlas/search`));
