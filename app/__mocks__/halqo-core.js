// The native Rust core can't load under jest. Tests that need specific core behaviour mock it themselves.
module.exports = new Proxy(
  {},
  {
    get: (_, name) => (name === '__esModule' ? false : () => {
      throw new Error(`@halqo/core.${String(name)} is native-only; mock it in this test`);
    }),
  },
);
