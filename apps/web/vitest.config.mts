import {defineConfig} from 'vitest/config';

// `lib/datetime.ts` converts between UTC instants and local wall-clock time,
// so its behaviour is a function of the zone it runs in. Pinning one makes the
// expectations concrete instead of derived from the same local getters they are
// meant to be checking. Central time is Baylor's, and it observes DST, which is
// the interesting half.
process.env.TZ = 'America/Chicago';

export default defineConfig({
  test: {
    // The event repository binds a `visibilitychange` listener and reads
    // `document.visibilityState`, which is behaviour worth testing rather than
    // stubbing out - a parked tab that keeps polling is a real defect.
    environment: 'jsdom',
    // Fills the gaps in jsdom that Astryx components hit on render. See the
    // file for why this is not a per-test concern.
    setupFiles: ['./vitest.setup.ts'],
    // Only `lib/` and `components/` are covered today. Left explicit so a test
    // file appearing somewhere unexpected is a visible decision.
    include: ['{lib,components}/**/*.test.{ts,tsx}'],
  },
  // tsconfig.json sets `jsx: preserve` for Next, which would leave JSX in the
  // output for the test runner to choke on. The automatic runtime is what Next
  // compiles to anyway, so this matches rather than diverges.
  oxc: {jsx: {runtime: 'automatic'}},
});
