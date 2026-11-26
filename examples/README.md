# Examples

All data here is fictional.

- `data/company.json`: departments and employees with nested addresses, arrays, a foreign key and a manager hierarchy. Try `dataghost inspect examples/data/company.json`.
- `config/dataghost.config.json`: customers, products and orders with a nested-array foreign key. Run `dataghost generate --config examples/config/dataghost.config.json`.
- `sdk/basic.mjs`: generate, inspect, synthesize, mask, validate and export with the SDK.
- `sdk/custom-generator.mjs`: register a custom generator (SDK only).

Run the SDK examples after `npm run build:packages`, for example `node examples/sdk/basic.mjs`.
