export const CONTRACT_LAB_CSS = `
.lab { max-width: 1180px; margin: 0 auto; padding: 32px 24px 64px; font-size: 15px; }
.lab [hidden] { display: none !important; }
.lab h1 { font-size: 24px; line-height: 1.25; margin: 12px 0; }
.lab h2 { font-size: 17px; font-weight: 650; margin: 0 0 8px; }
.lab p { max-width: 82ch; }
.lab-kicker, .lab-index { font: 600 11px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.lab-kicker { color: var(--neutral); }
.lab-intro { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 32px; align-items: center; }
.lab-rule { padding: 20px; color: var(--paper); background: var(--ink); border-radius: var(--radius); font-size: 14px; }
.lab-rule strong { display: block; font-size: 17px; margin: 6px 0; }
.lab-nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0; padding-bottom: 24px; border-bottom: 1px solid var(--border); }
.lab a, .lab select, .lab button { color: var(--ink); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font: inherit; min-height: 44px; }
.lab a { text-decoration: none; }
.lab a:hover, .lab button:hover { background: var(--surface-2); }
.lab :is(a, button, select, input):focus-visible { outline: 2px solid var(--watch); outline-offset: 3px; }
.lab section { margin-top: 40px; scroll-margin-top: 20px; }
.lab-section-head { display: flex; gap: 16px; align-items: baseline; }
.lab-index { color: var(--neutral); }
.lab-note { color: var(--neutral); font-size: 13px; margin: 8px 0 20px; }
.lab-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 16px; }
.lab-family { border: 1px solid var(--border); padding: 16px; border-radius: var(--radius); background: var(--surface); }
.lab-family h3 { margin: 0 0 12px; font-size: 15px; }
.lab-family ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.lab-family code { display: block; color: var(--neutral); font: 10px var(--font-mono); overflow-wrap: anywhere; }
.lab-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 16px; margin-bottom: 20px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.lab-toolbar select { max-width: 100%; }
.lab-sample { padding: 24px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.lab-sample h3 { font-size: 17px; margin-top: 0; }
.lab-strip { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(250px, 1fr); gap: 16px; overflow-x: auto; padding: 4px; }
.lab-result { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }
.lab-end { border-top: 1px solid var(--border); margin-top: 48px; padding-top: 16px; font-size: 13px; color: var(--neutral); }
body.lab-page { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-sans); }
.lab-sub { font-size: 13px; font-weight: 650; color: var(--neutral); margin: 24px 0 12px; }
.lab-change { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px 16px; margin: 0 0 16px; padding: 12px 16px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); }
.lab-change dt { font: 600 10px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--neutral); }
.lab-change dd { margin: 2px 0 0; font-size: 13px; overflow-wrap: anywhere; }
.lab-toolbar label { font: 600 11px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--neutral); }
.lab-badge-row { display: flex; flex-wrap: wrap; gap: 10px 16px; margin-bottom: 16px; }
.lab-family li { display: grid; gap: 4px; }
.lab-invalid { display: grid; gap: 20px; }
@media (max-width: 720px) {
  .lab { padding: 24px 16px 48px; }
  .lab-intro { grid-template-columns: 1fr; gap: 16px; }
  .lab-sample { padding: 12px; }
  .lab-strip { grid-auto-columns: minmax(240px, 85%); }
}
`;
